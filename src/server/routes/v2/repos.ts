import { existsSync } from 'node:fs'
import { join } from 'node:path'
import pkg from '../../../../package.json'
import { detectSetupSteps } from '../../agents/setup-detector'
import {
	cloneRepo,
	getGitHubOrgs,
	getGitHubRepos,
	getOrgRepos,
} from '../../api/github'
import { addRepo, withSetupFile } from '../../api/repos'
import {
	generateId,
	getAllSettings,
	getCloneDirectory,
	getSetting,
	listDirectories,
	loadConfig,
	log,
	saveConfig,
	setSetting,
} from '../../config'
import { emitGlobalActivity } from '../../db/activity'
import {
	dbDeleteRepo,
	dbGetRepo,
	dbInsertRepo,
	dbListRepos,
	dbUpdateRepoSetupSteps,
} from '../../db/repos'
import {
	dbDeleteScript,
	dbGetScript,
	dbInsertScript,
	dbListScriptsByRepo,
	dbUpdateScript,
} from '../../db/scripts'
import { dbListTeamsByRepo } from '../../db/teams'
import type { Repo } from '../../types'

// --- Extracted core logic functions ---

export function getSettings() {
	return getAllSettings()
}

export async function updateSettings(params: {
	settings: Record<string, string>
}) {
	for (const [key, value] of Object.entries(params.settings)) {
		await setSetting(key, String(value))
	}
	return getAllSettings()
}

export function getVersion() {
	return { version: pkg.version }
}

export async function getCloneDir() {
	const dir = await getCloneDirectory()
	return { cloneDirectory: dir }
}

export async function setCloneDir(params: { cloneDirectory: string }) {
	if (!params.cloneDirectory || typeof params.cloneDirectory !== 'string') {
		return { error: 'Missing cloneDirectory field' }
	}
	const config = await loadConfig()
	config.cloneDirectory = params.cloneDirectory
	await saveConfig(config)
	return { cloneDirectory: params.cloneDirectory }
}

export function listDirs(params: { path: string }) {
	const dirs = listDirectories(params.path)
	return { directories: dirs }
}

export async function listGithubRepos() {
	return { repos: await getGitHubRepos() }
}

export async function listGithubOrgs() {
	return { orgs: await getGitHubOrgs() }
}

export async function listOrgRepos(params: { org: string }) {
	return { repos: await getOrgRepos(params.org) }
}

export function listRepos() {
	return dbListRepos()
}

async function finalizeRepo(repo: Repo | string) {
	if (typeof repo === 'string') return { error: repo }
	dbInsertRepo(repo)
	if (
		(await getSetting('autoDetect')) === 'true' &&
		!existsSync(join(repo.path, '.grove', 'setup.json'))
	) {
		triggerDetection(repo)
	}
	return withSetupFile(repo)
}

export async function addRepoHandler(params: { path: string }) {
	return finalizeRepo(await addRepo(params.path))
}

export async function cloneRepoHandler(params: { fullName: string }) {
	return finalizeRepo(await cloneRepo(params.fullName))
}

export function deleteRepo(params: { id: string }) {
	const deleted = dbDeleteRepo(params.id)
	if (!deleted) return { error: 'Repo not found' }
	return { success: true }
}

export function listRepoTeams(params: { id: string }) {
	const repo = dbGetRepo(params.id)
	if (!repo) return { error: 'Repo not found' }
	return dbListTeamsByRepo(params.id)
}

export async function listSetupSteps(params: { id: string }) {
	const repo = dbGetRepo(params.id)
	if (!repo) return { error: 'Repo not found' }
	const setupFile = join(repo.path, '.grove', 'setup.json')
	if (existsSync(setupFile)) {
		const data = await Bun.file(setupFile).json()
		return data.setup ?? []
	}
	return repo.setupSteps ?? []
}

export function addSetupStep(params: {
	id: string
	name: string
	run: string
	background?: boolean
}) {
	const repo = dbGetRepo(params.id)
	if (!repo) return { error: 'Repo not found' }
	if (!params.name || !params.run) return { error: 'Missing name or run' }
	const steps = repo.setupSteps ?? []
	steps.push({
		name: params.name,
		run: params.run,
		background: params.background || undefined,
	})
	dbUpdateRepoSetupSteps(params.id, steps)
	return steps
}

export function updateSetupStep(params: {
	id: string
	index: number
	name: string
	run: string
	background?: boolean
}) {
	const repo = dbGetRepo(params.id)
	if (!repo) return { error: 'Repo not found' }
	if (typeof params.index !== 'number' || !params.name || !params.run)
		return { error: 'Missing index, name, or run' }
	const steps = repo.setupSteps ?? []
	if (params.index < 0 || params.index >= steps.length)
		return { error: 'Invalid index' }
	steps[params.index] = {
		name: params.name,
		run: params.run,
		background: params.background || undefined,
	}
	dbUpdateRepoSetupSteps(params.id, steps)
	return steps
}

export function deleteSetupStep(params: { id: string; index: number }) {
	const repo = dbGetRepo(params.id)
	if (!repo) return { error: 'Repo not found' }
	if (typeof params.index !== 'number') return { error: 'Missing index' }
	const steps = repo.setupSteps ?? []
	if (params.index < 0 || params.index >= steps.length)
		return { error: 'Invalid index' }
	steps.splice(params.index, 1)
	dbUpdateRepoSetupSteps(params.id, steps.length > 0 ? steps : undefined)
	return steps
}

export function reorderSetupSteps(params: { id: string; order: number[] }) {
	const repo = dbGetRepo(params.id)
	if (!repo) return { error: 'Repo not found' }
	if (!Array.isArray(params.order)) return { error: 'Missing order array' }
	const steps = repo.setupSteps ?? []
	if (
		params.order.length !== steps.length ||
		![...params.order]
			.sort((a: number, b: number) => a - b)
			.every((v: number, i: number) => v === i)
	)
		return { error: 'order must be a permutation of current indices' }
	const reordered = params.order.map((i: number) => steps[i])
	dbUpdateRepoSetupSteps(params.id, reordered)
	return reordered
}

export function detectRepoSetup(params: { id: string }) {
	const repo = dbGetRepo(params.id)
	if (!repo) return { error: 'Repo not found' }
	triggerDetection(repo)
	return { detecting: true }
}

export function listRepoScripts(params: { id: string }) {
	const repo = dbGetRepo(params.id)
	if (!repo) return { error: 'Repo not found' }
	return dbListScriptsByRepo(params.id)
}

export function createRepoScript(params: {
	id: string
	name: string
	run: string
	background?: boolean
}) {
	const repo = dbGetRepo(params.id)
	if (!repo) return { error: 'Repo not found' }
	if (!params.name || !params.run) return { error: 'Missing name or run' }
	const script = {
		id: generateId(),
		repoId: params.id,
		name: params.name,
		run: params.run,
		background: params.background || undefined,
		createdAt: Date.now(),
	}
	dbInsertScript(script)
	return script
}

export function updateScript(params: {
	id: string
	name: string
	run: string
	background?: boolean
}) {
	const script = dbGetScript(params.id)
	if (!script) return { error: 'Script not found' }
	if (!params.name || !params.run) return { error: 'Missing name or run' }
	dbUpdateScript(params.id, {
		name: params.name,
		run: params.run,
		background: params.background || undefined,
	})
	return {
		...script,
		name: params.name,
		run: params.run,
		background: params.background || undefined,
	}
}

export function deleteScript(params: { id: string }) {
	const script = dbGetScript(params.id)
	if (!script) return { error: 'Script not found' }
	dbDeleteScript(params.id)
	return { success: true }
}

// --- Private helpers ---

function triggerDetection(repo: Repo) {
	detectSetupSteps(repo.id, repo.path)
		.then(result => {
			if (result) {
				emitGlobalActivity('repo:setup-detected', {
					repoId: repo.id,
					steps: result.steps,
					scripts: result.scripts ?? [],
					envVars: result.envVars ?? [],
					fingerprint: result.fingerprint ?? null,
					needsNativeBuild: result.needsNativeBuild ?? false,
				})
			} else {
				emitGlobalActivity('repo:setup-detection-failed', { repoId: repo.id })
			}
		})
		.catch(err => {
			log('setup-detector', 'post-detection error', {
				repoId: repo.id,
				err,
			})
			emitGlobalActivity('repo:setup-detection-failed', { repoId: repo.id })
		})
}

function matchRoute(
	path: string,
	pattern: string,
): Record<string, string> | null {
	const pathParts = path.split('/').filter(Boolean)
	const patternParts = pattern.split('/').filter(Boolean)
	if (pathParts.length !== patternParts.length) return null
	const params: Record<string, string> = {}
	for (let i = 0; i < patternParts.length; i++) {
		if (patternParts[i].startsWith(':')) {
			params[patternParts[i].slice(1)] = pathParts[i]
		} else if (patternParts[i] !== pathParts[i]) {
			return null
		}
	}
	return params
}

export async function handleV2Repos(
	req: Request,
	url: URL,
	headers: Record<string, string>,
): Promise<Response | null> {
	const path = url.pathname
	const method = req.method

	if (path === '/v2/config/settings' && method === 'GET') {
		return Response.json(await getSettings(), { headers })
	}

	if (path === '/v2/config/settings' && method === 'PATCH') {
		const body = await req.json()
		return Response.json(await updateSettings({ settings: body }), { headers })
	}

	if (path === '/v2/version' && method === 'GET') {
		return Response.json(await getVersion(), { headers })
	}

	if (path === '/v2/config/clone-directory' && method === 'GET') {
		return Response.json(await getCloneDir(), { headers })
	}

	if (path === '/v2/config/clone-directory' && method === 'PUT') {
		const body = await req.json()
		const result = await setCloneDir({ cloneDirectory: body.cloneDirectory })
		if ('error' in result)
			return Response.json(result, { status: 400, headers })
		return Response.json(result, { headers })
	}

	if (path === '/v2/config/list-directories' && method === 'GET') {
		const queryPath = url.searchParams.get('path') ?? '/'
		return Response.json(listDirs({ path: queryPath }), { headers })
	}

	if (path === '/v2/github/repos' && method === 'GET') {
		return Response.json(await listGithubRepos(), { headers })
	}

	if (path === '/v2/github/repos/orgs' && method === 'GET') {
		return Response.json(await listGithubOrgs(), { headers })
	}

	const orgReposMatch = matchRoute(path, '/v2/github/repos/orgs/:org')
	if (orgReposMatch && method === 'GET') {
		return Response.json(await listOrgRepos({ org: orgReposMatch.org }), {
			headers,
		})
	}

	if (path === '/v2/repos' && method === 'GET') {
		return Response.json(listRepos(), { headers })
	}

	if (path === '/v2/repos' && method === 'POST') {
		const body = await req.json()
		const result = await addRepoHandler({ path: body.path })
		if ('error' in result)
			return Response.json(result, { status: 400, headers })
		return Response.json(result, { headers })
	}

	if (path === '/v2/repos/clone' && method === 'POST') {
		const body = await req.json()
		const result = await cloneRepoHandler({ fullName: body.fullName })
		if ('error' in result)
			return Response.json(result, { status: 400, headers })
		return Response.json(result, { headers })
	}

	const repoMatch = matchRoute(path, '/v2/repos/:id')
	if (repoMatch && method === 'DELETE') {
		const result = deleteRepo({ id: repoMatch.id })
		if ('error' in result)
			return Response.json(result, { status: 404, headers })
		return Response.json(result, { headers })
	}

	const repoTeamsMatch = matchRoute(path, '/v2/repos/:id/teams')
	if (repoTeamsMatch && method === 'GET') {
		const result = listRepoTeams({ id: repoTeamsMatch.id })
		if ('error' in result)
			return Response.json(result, { status: 404, headers })
		return Response.json(result, { headers })
	}

	const setupMatch = matchRoute(path, '/v2/repos/:id/setup')
	if (setupMatch) {
		if (method === 'GET') {
			const result = await listSetupSteps({ id: setupMatch.id })
			if (!Array.isArray(result) && 'error' in result)
				return Response.json(result, { status: 404, headers })
			return Response.json(result, { headers })
		}

		if (method === 'POST') {
			const body = await req.json()
			const result = addSetupStep({
				id: setupMatch.id,
				name: body.name,
				run: body.run,
				background: body.background,
			})
			if ('error' in result) {
				const status = result.error === 'Repo not found' ? 404 : 400
				return Response.json(result, { status, headers })
			}
			return Response.json(result, { headers })
		}

		if (method === 'PUT') {
			const body = await req.json()
			const result = updateSetupStep({
				id: setupMatch.id,
				index: body.index,
				name: body.name,
				run: body.run,
				background: body.background,
			})
			if ('error' in result) {
				const status = result.error === 'Repo not found' ? 404 : 400
				return Response.json(result, { status, headers })
			}
			return Response.json(result, { headers })
		}

		if (method === 'DELETE') {
			const body = await req.json()
			const result = deleteSetupStep({
				id: setupMatch.id,
				index: body.index,
			})
			if ('error' in result) {
				const status = result.error === 'Repo not found' ? 404 : 400
				return Response.json(result, { status, headers })
			}
			return Response.json(result, { headers })
		}
	}

	const setupReorderMatch = matchRoute(path, '/v2/repos/:id/setup/reorder')
	if (setupReorderMatch && method === 'PATCH') {
		const body = await req.json()
		const result = reorderSetupSteps({
			id: setupReorderMatch.id,
			order: body.order,
		})
		if ('error' in result) {
			const status = result.error === 'Repo not found' ? 404 : 400
			return Response.json(result, { status, headers })
		}
		return Response.json(result, { headers })
	}

	const detectMatch = matchRoute(path, '/v2/repos/:id/detect')
	if (detectMatch && method === 'POST') {
		const result = detectRepoSetup({ id: detectMatch.id })
		if ('error' in result)
			return Response.json(result, { status: 404, headers })
		return Response.json(result, { headers })
	}

	const scriptsMatch = matchRoute(path, '/v2/repos/:id/scripts')
	if (scriptsMatch) {
		if (method === 'GET') {
			const result = listRepoScripts({ id: scriptsMatch.id })
			if ('error' in result)
				return Response.json(result, { status: 404, headers })
			return Response.json(result, { headers })
		}

		if (method === 'POST') {
			const body = await req.json()
			const result = await createRepoScript({
				id: scriptsMatch.id,
				name: body.name,
				run: body.run,
				background: body.background,
			})
			if ('error' in result) {
				const status = result.error === 'Repo not found' ? 404 : 400
				return Response.json(result, { status, headers })
			}
			return Response.json(result, { headers })
		}
	}

	const scriptMatch = matchRoute(path, '/v2/scripts/:id')
	if (scriptMatch) {
		if (method === 'PUT') {
			const body = await req.json()
			const result = updateScript({
				id: scriptMatch.id,
				name: body.name,
				run: body.run,
				background: body.background,
			})
			if ('error' in result) {
				const status = result.error === 'Script not found' ? 404 : 400
				return Response.json(result, { status, headers })
			}
			return Response.json(result, { headers })
		}

		if (method === 'DELETE') {
			const result = deleteScript({ id: scriptMatch.id })
			if ('error' in result)
				return Response.json(result, { status: 404, headers })
			return Response.json(result, { headers })
		}
	}

	return null
}
