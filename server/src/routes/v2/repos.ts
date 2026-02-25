import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { detectSetupSteps } from '../../agents/setup-detector'
import {
	cloneRepo,
	getGitHubOrgs,
	getGitHubRepos,
	getOrgRepos,
} from '../../api/github'
import { addRepo, withSetupFile } from '../../api/repos'
import { listDirectories, loadConfig, log, saveConfig } from '../../config'
import { emitGlobalEvent } from '../../db/events'
import {
	dbDeleteRepo,
	dbGetRepo,
	dbInsertRepo,
	dbListRepos,
	dbUpdateRepoSetupSteps,
} from '../../db/repos'
import { dbListTeamsByRepo } from '../../db/teams'
import type { Repo } from '../../types'

function triggerDetection(repo: Repo) {
	detectSetupSteps(repo.id, repo.path)
		.then(result => {
			if (result) {
				emitGlobalEvent('repo:setup-detected', {
					repoId: repo.id,
					steps: result.steps,
					envVars: result.envVars ?? [],
					fingerprint: result.fingerprint ?? null,
					needsNativeBuild: result.needsNativeBuild ?? false,
				})
			} else {
				emitGlobalEvent('repo:setup-detection-failed', { repoId: repo.id })
			}
		})
		.catch(err => {
			log('setup-detector', 'post-detection error', {
				repoId: repo.id,
				err,
			})
			emitGlobalEvent('repo:setup-detection-failed', { repoId: repo.id })
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
		const config = await loadConfig()
		return Response.json(
			{ autoDetect: config.autoDetect ?? false },
			{ headers },
		)
	}

	if (path === '/v2/config/settings' && method === 'PATCH') {
		const body = await req.json()
		const config = await loadConfig()
		if (typeof body.autoDetect === 'boolean') {
			config.autoDetect = body.autoDetect
		}
		await saveConfig(config)
		return Response.json(
			{ autoDetect: config.autoDetect ?? false },
			{ headers },
		)
	}

	if (path === '/v2/config/list-directories' && method === 'GET') {
		const queryPath = url.searchParams.get('path') ?? '/'
		const dirs = listDirectories(queryPath)
		return Response.json({ directories: dirs }, { headers })
	}

	if (path === '/v2/github/repos' && method === 'GET') {
		return Response.json({ repos: await getGitHubRepos() }, { headers })
	}

	if (path === '/v2/github/repos/orgs' && method === 'GET') {
		return Response.json({ orgs: await getGitHubOrgs() }, { headers })
	}

	const orgReposMatch = matchRoute(path, '/v2/github/repos/orgs/:org')
	if (orgReposMatch && method === 'GET') {
		return Response.json(
			{ repos: await getOrgRepos(orgReposMatch.org) },
			{ headers },
		)
	}

	if (path === '/v2/repos' && method === 'GET') {
		return Response.json(dbListRepos(), { headers })
	}

	if (path === '/v2/repos' && method === 'POST') {
		const body = await req.json()
		const repo = await addRepo(body.path)
		if (typeof repo === 'string')
			return Response.json({ error: repo }, { status: 400, headers })
		dbInsertRepo(repo)
		const config = await loadConfig()
		if (
			config.autoDetect &&
			!existsSync(join(repo.path, '.grove', 'setup.json'))
		) {
			triggerDetection(repo)
		}
		return Response.json(withSetupFile(repo), { headers })
	}

	if (path === '/v2/repos/clone' && method === 'POST') {
		const body = await req.json()
		const repo = await cloneRepo(body.fullName)
		if (typeof repo === 'string')
			return Response.json({ error: repo }, { status: 400, headers })
		dbInsertRepo(repo)
		const config = await loadConfig()
		if (
			config.autoDetect &&
			!existsSync(join(repo.path, '.grove', 'setup.json'))
		) {
			triggerDetection(repo)
		}
		return Response.json(withSetupFile(repo), { headers })
	}

	const repoMatch = matchRoute(path, '/v2/repos/:id')
	if (repoMatch && method === 'DELETE') {
		const deleted = dbDeleteRepo(repoMatch.id)
		if (!deleted)
			return Response.json(
				{ error: 'Repo not found' },
				{ status: 404, headers },
			)
		return Response.json({ success: true }, { headers })
	}

	const repoTeamsMatch = matchRoute(path, '/v2/repos/:id/teams')
	if (repoTeamsMatch && method === 'GET') {
		const repo = dbGetRepo(repoTeamsMatch.id)
		if (!repo)
			return Response.json(
				{ error: 'Repo not found' },
				{ status: 404, headers },
			)
		const teams = dbListTeamsByRepo(repoTeamsMatch.id)
		return Response.json(teams, { headers })
	}

	const setupMatch = matchRoute(path, '/v2/repos/:id/setup')
	if (setupMatch) {
		const repo = dbGetRepo(setupMatch.id)
		if (!repo)
			return Response.json(
				{ error: 'Repo not found' },
				{ status: 404, headers },
			)

		if (method === 'GET') {
			const setupFile = join(repo.path, '.grove', 'setup.json')
			if (existsSync(setupFile)) {
				const data = await Bun.file(setupFile).json()
				return Response.json(data.setup ?? [], { headers })
			}
			return Response.json(repo.setupSteps ?? [], { headers })
		}

		if (method === 'POST') {
			const body = await req.json()
			if (!body.name || !body.run)
				return Response.json(
					{ error: 'Missing name or run' },
					{ status: 400, headers },
				)
			const steps = repo.setupSteps ?? []
			steps.push({
				name: body.name,
				run: body.run,
				background: body.background || undefined,
			})
			dbUpdateRepoSetupSteps(setupMatch.id, steps)
			return Response.json(steps, { headers })
		}

		if (method === 'PUT') {
			const body = await req.json()
			if (typeof body.index !== 'number' || !body.name || !body.run)
				return Response.json(
					{ error: 'Missing index, name, or run' },
					{ status: 400, headers },
				)
			const steps = repo.setupSteps ?? []
			if (body.index < 0 || body.index >= steps.length)
				return Response.json(
					{ error: 'Invalid index' },
					{ status: 400, headers },
				)
			steps[body.index] = {
				name: body.name,
				run: body.run,
				background: body.background || undefined,
			}
			dbUpdateRepoSetupSteps(setupMatch.id, steps)
			return Response.json(steps, { headers })
		}

		if (method === 'DELETE') {
			const body = await req.json()
			if (typeof body.index !== 'number')
				return Response.json(
					{ error: 'Missing index' },
					{ status: 400, headers },
				)
			const steps = repo.setupSteps ?? []
			if (body.index < 0 || body.index >= steps.length)
				return Response.json(
					{ error: 'Invalid index' },
					{ status: 400, headers },
				)
			steps.splice(body.index, 1)
			dbUpdateRepoSetupSteps(
				setupMatch.id,
				steps.length > 0 ? steps : undefined,
			)
			return Response.json(steps, { headers })
		}
	}

	const setupReorderMatch = matchRoute(path, '/v2/repos/:id/setup/reorder')
	if (setupReorderMatch && method === 'PATCH') {
		const repo = dbGetRepo(setupReorderMatch.id)
		if (!repo)
			return Response.json(
				{ error: 'Repo not found' },
				{ status: 404, headers },
			)
		const body = await req.json()
		if (!Array.isArray(body.order))
			return Response.json(
				{ error: 'Missing order array' },
				{ status: 400, headers },
			)
		const steps = repo.setupSteps ?? []
		if (
			body.order.length !== steps.length ||
			![...body.order]
				.sort((a: number, b: number) => a - b)
				.every((v: number, i: number) => v === i)
		)
			return Response.json(
				{ error: 'order must be a permutation of current indices' },
				{ status: 400, headers },
			)
		const reordered = body.order.map((i: number) => steps[i])
		dbUpdateRepoSetupSteps(setupReorderMatch.id, reordered)
		return Response.json(reordered, { headers })
	}

	const detectMatch = matchRoute(path, '/v2/repos/:id/detect')
	if (detectMatch && method === 'POST') {
		const repo = dbGetRepo(detectMatch.id)
		if (!repo)
			return Response.json(
				{ error: 'Repo not found' },
				{ status: 404, headers },
			)

		triggerDetection(repo)
		return Response.json({ detecting: true }, { headers })
	}

	return null
}
