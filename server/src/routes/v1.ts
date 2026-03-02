import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
	cloneRepo,
	getGitHubOrgs,
	getGitHubRepos,
	getOrgRepos,
} from '../api/github'
import { addRepo, deleteRepo, getRepos, withSetupFile } from '../api/repos'
import {
	addSSEClient,
	clearSessionFocused,
	createPR,
	createSession,
	deleteSession,
	getBehindMain,
	getSessions,
	getWebhookUrl,
	mergeMain,
	removeSSEClient,
	removeWebhookUrl,
	setAppFocused,
	setSessionFocused,
	setWebhookUrl,
	uploadFile,
} from '../api/sessions'
import { cancelSetup, retrySetup, startStep, stopStep } from '../api/setup'
import {
	createWorktree,
	deleteWorktree,
	detectEnvVars,
	getWorktrees,
} from '../api/worktrees'
import {
	addPushToken,
	getCloneDirectory,
	listDirectories,
	loadConfig,
	removePushToken,
	saveConfig,
} from '../config'

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

export async function handleV1(
	req: Request,
	url: URL,
	headers: Record<string, string>,
): Promise<Response | null> {
	const path = url.pathname
	const method = req.method

	if (path === '/v1/activity' && method === 'GET') {
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode('data: {"type":"connected"}\n\n'),
				)
				addSSEClient(controller)
				const heartbeat = setInterval(() => {
					try {
						controller.enqueue(
							new TextEncoder().encode('data: {"type":"heartbeat"}\n\n'),
						)
					} catch {
						clearInterval(heartbeat)
					}
				}, 30000)
				req.signal.addEventListener('abort', () => {
					clearInterval(heartbeat)
					removeSSEClient(controller)
				})
			},
		})
		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
				'Access-Control-Allow-Origin': '*',
			},
		})
	}

	if (path === '/v1/repos' && method === 'GET') {
		return Response.json(await getRepos(), { headers })
	}

	if (path === '/v1/repos' && method === 'POST') {
		const body = await req.json()
		const repo = await addRepo(body.path)
		if (typeof repo === 'string') {
			return Response.json({ error: repo }, { status: 400, headers })
		}
		return Response.json(withSetupFile(repo), { headers })
	}

	const repoMatch = matchRoute(path, '/v1/repos/:id')
	if (repoMatch && method === 'DELETE') {
		const deleted = await deleteRepo(repoMatch.id)
		if (typeof deleted === 'string') {
			return Response.json({ error: deleted }, { status: 404, headers })
		}
		return Response.json({ success: true }, { headers })
	}

	const envDetectMatch = matchRoute(path, '/v1/repos/:id/env/scan')
	if (envDetectMatch && method === 'POST') {
		const config = await loadConfig()
		const repo = config.repos.find(r => r.id === envDetectMatch.id)
		if (!repo) {
			return Response.json(
				{ error: 'Repo not found' },
				{ status: 404, headers },
			)
		}
		const envVars = await detectEnvVars(repo.path)
		repo.envVars = envVars.length > 0 ? envVars : undefined
		await saveConfig(config)
		return Response.json(envVars, { headers })
	}

	const envMatch = matchRoute(path, '/v1/repos/:id/env')
	if (envMatch && method === 'GET') {
		const config = await loadConfig()
		const repo = config.repos.find(r => r.id === envMatch.id)
		if (!repo) {
			return Response.json(
				{ error: 'Repo not found' },
				{ status: 404, headers },
			)
		}
		return Response.json(repo.envVars ?? [], { headers })
	}

	if (envMatch && method === 'POST') {
		const config = await loadConfig()
		const repo = config.repos.find(r => r.id === envMatch.id)
		if (!repo) {
			return Response.json(
				{ error: 'Repo not found' },
				{ status: 404, headers },
			)
		}
		const body = await req.json()
		if (!body.key || !body.filePath) {
			return Response.json(
				{ error: 'Missing key or filePath' },
				{ status: 400, headers },
			)
		}
		if (!repo.envVars) repo.envVars = []
		const existing = repo.envVars.find(
			v => v.key === body.key && v.filePath === body.filePath,
		)
		if (existing) {
			existing.value = body.value ?? ''
		} else {
			repo.envVars.push({
				key: body.key,
				value: body.value ?? '',
				filePath: body.filePath,
			})
		}
		await saveConfig(config)
		return Response.json(repo.envVars, { headers })
	}

	if (envMatch && method === 'DELETE') {
		const config = await loadConfig()
		const repo = config.repos.find(r => r.id === envMatch.id)
		if (!repo) {
			return Response.json(
				{ error: 'Repo not found' },
				{ status: 404, headers },
			)
		}
		const body = await req.json()
		if (!body.key || !body.filePath) {
			return Response.json(
				{ error: 'Missing key or filePath' },
				{ status: 400, headers },
			)
		}
		if (repo.envVars) {
			repo.envVars = repo.envVars.filter(
				v => !(v.key === body.key && v.filePath === body.filePath),
			)
			if (repo.envVars.length === 0) repo.envVars = undefined
		}
		await saveConfig(config)
		return Response.json(repo.envVars ?? [], { headers })
	}

	const setupMatch = matchRoute(path, '/v1/repos/:id/setup')
	if (setupMatch && method === 'GET') {
		const config = await loadConfig()
		const repo = config.repos.find(r => r.id === setupMatch.id)
		if (!repo) {
			return Response.json(
				{ error: 'Repo not found' },
				{ status: 404, headers },
			)
		}
		const setupFile = join(repo.path, '.grove', 'setup.json')
		if (existsSync(setupFile)) {
			const data = await Bun.file(setupFile).json()
			return Response.json(data.setup ?? [], { headers })
		}
		return Response.json(repo.setupSteps ?? [], { headers })
	}

	if (setupMatch && method === 'POST') {
		const config = await loadConfig()
		const repo = config.repos.find(r => r.id === setupMatch.id)
		if (!repo) {
			return Response.json(
				{ error: 'Repo not found' },
				{ status: 404, headers },
			)
		}
		const body = await req.json()
		if (!body.name || !body.run) {
			return Response.json(
				{ error: 'Missing name or run' },
				{ status: 400, headers },
			)
		}
		if (!repo.setupSteps) repo.setupSteps = []
		repo.setupSteps.push({
			name: body.name,
			run: body.run,
			background: body.background || undefined,
		})
		await saveConfig(config)
		return Response.json(repo.setupSteps, { headers })
	}

	if (setupMatch && method === 'PUT') {
		const config = await loadConfig()
		const repo = config.repos.find(r => r.id === setupMatch.id)
		if (!repo) {
			return Response.json(
				{ error: 'Repo not found' },
				{ status: 404, headers },
			)
		}
		const body = await req.json()
		if (typeof body.index !== 'number' || !body.name || !body.run) {
			return Response.json(
				{ error: 'Missing index, name, or run' },
				{ status: 400, headers },
			)
		}
		if (
			!repo.setupSteps ||
			body.index < 0 ||
			body.index >= repo.setupSteps.length
		) {
			return Response.json({ error: 'Invalid index' }, { status: 400, headers })
		}
		repo.setupSteps[body.index] = {
			name: body.name,
			run: body.run,
			background: body.background || undefined,
		}
		await saveConfig(config)
		return Response.json(repo.setupSteps, { headers })
	}

	if (setupMatch && method === 'DELETE') {
		const config = await loadConfig()
		const repo = config.repos.find(r => r.id === setupMatch.id)
		if (!repo) {
			return Response.json(
				{ error: 'Repo not found' },
				{ status: 404, headers },
			)
		}
		const body = await req.json()
		if (typeof body.index !== 'number') {
			return Response.json({ error: 'Missing index' }, { status: 400, headers })
		}
		if (
			!repo.setupSteps ||
			body.index < 0 ||
			body.index >= repo.setupSteps.length
		) {
			return Response.json({ error: 'Invalid index' }, { status: 400, headers })
		}
		repo.setupSteps.splice(body.index, 1)
		if (repo.setupSteps.length === 0) repo.setupSteps = undefined
		await saveConfig(config)
		return Response.json(repo.setupSteps ?? [], { headers })
	}

	const setupReorderMatch = matchRoute(path, '/v1/repos/:id/setup/reorder')
	if (setupReorderMatch && method === 'PATCH') {
		const config = await loadConfig()
		const repo = config.repos.find(r => r.id === setupReorderMatch.id)
		if (!repo) {
			return Response.json(
				{ error: 'Repo not found' },
				{ status: 404, headers },
			)
		}
		const body = await req.json()
		if (!Array.isArray(body.order)) {
			return Response.json(
				{ error: 'Missing order array' },
				{ status: 400, headers },
			)
		}
		const steps = repo.setupSteps ?? []
		if (
			body.order.length !== steps.length ||
			![...body.order]
				.sort((a: number, b: number) => a - b)
				.every((v: number, i: number) => v === i)
		) {
			return Response.json(
				{ error: 'order must be a permutation of current indices' },
				{ status: 400, headers },
			)
		}
		repo.setupSteps = body.order.map((i: number) => steps[i])
		await saveConfig(config)
		return Response.json(repo.setupSteps, { headers })
	}

	const orgReposMatch = matchRoute(path, '/v1/github/repos/orgs/:org')
	if (orgReposMatch && method === 'GET') {
		return Response.json(
			{ repos: await getOrgRepos(orgReposMatch.org) },
			{ headers },
		)
	}

	if (path === '/v1/github/repos/orgs' && method === 'GET') {
		return Response.json({ orgs: await getGitHubOrgs() }, { headers })
	}

	if (path === '/v1/github/repos' && method === 'GET') {
		return Response.json({ repos: await getGitHubRepos() }, { headers })
	}

	if (path === '/v1/repos/clone' && method === 'POST') {
		const body = await req.json()
		const repo = await cloneRepo(body.fullName)
		if (typeof repo === 'string') {
			return Response.json({ error: repo }, { status: 400, headers })
		}
		return Response.json(withSetupFile(repo), { headers })
	}

	if (path === '/v1/sessions' && method === 'GET') {
		return Response.json(await getSessions(), { headers })
	}

	if (path === '/v1/sessions' && method === 'POST') {
		const body = await req.json()
		const session = await createSession(
			body.repoId,
			body.worktree,
			body.skipPermissions,
		)
		if (typeof session === 'string') {
			return Response.json({ error: session }, { status: 400, headers })
		}
		return Response.json(session, { headers })
	}

	const sessionMatch = matchRoute(path, '/v1/sessions/:id')
	if (sessionMatch && method === 'DELETE') {
		const deleted = await deleteSession(sessionMatch.id)
		if (!deleted) {
			return Response.json(
				{ error: 'Session not found' },
				{ status: 404, headers },
			)
		}
		return Response.json({ success: true }, { headers })
	}

	const focusMatch = matchRoute(path, '/v1/sessions/:id/focus')
	if (focusMatch && method === 'POST') {
		setSessionFocused(focusMatch.id)
		return Response.json({ success: true }, { headers })
	}
	if (focusMatch && method === 'DELETE') {
		clearSessionFocused(focusMatch.id)
		return Response.json({ success: true }, { headers })
	}

	const setupRetryMatch = matchRoute(path, '/v1/sessions/:id/setup/retry')
	if (setupRetryMatch && method === 'POST') {
		await retrySetup(setupRetryMatch.id)
		return Response.json({ success: true }, { headers })
	}

	const setupCancelMatch = matchRoute(path, '/v1/sessions/:id/setup/cancel')
	if (setupCancelMatch && method === 'POST') {
		cancelSetup(setupCancelMatch.id)
		return Response.json({ success: true }, { headers })
	}

	const setupStopMatch = matchRoute(path, '/v1/sessions/:id/setup/stop')
	if (setupStopMatch && method === 'POST') {
		const body = await req.json()
		if (typeof body.step !== 'number') {
			return Response.json(
				{ error: 'Missing step index' },
				{ status: 400, headers },
			)
		}
		const error = stopStep(setupStopMatch.id, body.step)
		if (error) {
			return Response.json({ error }, { status: 400, headers })
		}
		return Response.json({ success: true }, { headers })
	}

	const setupStartMatch = matchRoute(path, '/v1/sessions/:id/setup/start')
	if (setupStartMatch && method === 'POST') {
		const body = await req.json()
		if (typeof body.step !== 'number') {
			return Response.json(
				{ error: 'Missing step index' },
				{ status: 400, headers },
			)
		}
		const error = startStep(setupStartMatch.id, body.step)
		if (error) {
			return Response.json({ error }, { status: 400, headers })
		}
		return Response.json({ success: true }, { headers })
	}

	const behindMainMatch = matchRoute(path, '/v1/sessions/:id/behind-main')
	if (behindMainMatch && method === 'GET') {
		const behind = await getBehindMain(behindMainMatch.id)
		if (typeof behind === 'string') {
			return Response.json({ error: behind }, { status: 404, headers })
		}
		return Response.json({ behind }, { headers })
	}

	const mergeMainMatch = matchRoute(path, '/v1/sessions/:id/merge-main')
	if (mergeMainMatch && method === 'POST') {
		const body = await req.json()
		if (body.strategy !== 'merge' && body.strategy !== 'rebase') {
			return Response.json(
				{ error: 'Invalid strategy' },
				{ status: 400, headers },
			)
		}
		const result = await mergeMain(mergeMainMatch.id, body.strategy)
		if (!result.success) {
			return Response.json({ error: result.error }, { status: 400, headers })
		}
		return Response.json({ success: true }, { headers })
	}

	const createPRMatch = matchRoute(path, '/v1/sessions/:id/create-pr')
	if (createPRMatch && method === 'POST') {
		const result = await createPR(createPRMatch.id)
		if (!result.success) {
			return Response.json({ error: result.error }, { status: 400, headers })
		}
		return Response.json({ url: result.url }, { headers })
	}

	const uploadMatch = matchRoute(path, '/v1/sessions/:id/upload')
	if (uploadMatch && method === 'POST') {
		const formData = await req.formData()
		const file = formData.get('file')
		if (!file || !(file instanceof File)) {
			return Response.json(
				{ error: 'No file provided' },
				{ status: 400, headers },
			)
		}
		const result = await uploadFile(uploadMatch.id, file)
		if (typeof result === 'string') {
			return Response.json({ error: result }, { status: 404, headers })
		}
		return Response.json(result, { headers })
	}

	const worktreeMatch = matchRoute(path, '/v1/worktrees/:repoId')
	if (worktreeMatch && method === 'GET') {
		const worktrees = await getWorktrees(worktreeMatch.repoId)
		return Response.json(worktrees, { headers })
	}

	if (path === '/v1/worktrees' && method === 'POST') {
		const body = await req.json()
		const worktree = await createWorktree(
			body.repoId,
			body.branch,
			body.baseBranch,
		)
		if (typeof worktree === 'string') {
			return Response.json({ error: worktree }, { status: 400, headers })
		}
		return Response.json(worktree, { headers })
	}

	if (path === '/v1/worktrees' && method === 'DELETE') {
		const body = await req.json()
		const deleted = await deleteWorktree(body.repoId, body.branch, body.force)
		if (typeof deleted === 'string') {
			return Response.json({ error: deleted }, { status: 400, headers })
		}
		return Response.json({ success: true }, { headers })
	}

	if (path === '/v1/config/list-directories' && method === 'GET') {
		const queryPath = url.searchParams.get('path') ?? '/'
		const dirs = listDirectories(queryPath)
		return Response.json({ directories: dirs }, { headers })
	}

	if (path === '/v1/config/clone-directory' && method === 'GET') {
		const dir = await getCloneDirectory()
		return Response.json({ cloneDirectory: dir }, { headers })
	}

	if (path === '/v1/config/clone-directory' && method === 'PUT') {
		const body = await req.json()
		if (!body.cloneDirectory || typeof body.cloneDirectory !== 'string') {
			return Response.json(
				{ error: 'Missing cloneDirectory field' },
				{ status: 400, headers },
			)
		}
		const config = await loadConfig()
		config.cloneDirectory = body.cloneDirectory
		await saveConfig(config)
		return Response.json({ cloneDirectory: body.cloneDirectory }, { headers })
	}

	if (path === '/v1/webhook' && method === 'GET') {
		const webhookUrl = await getWebhookUrl()
		return Response.json({ webhookUrl: webhookUrl ?? null }, { headers })
	}

	if (path === '/v1/webhook' && method === 'POST') {
		const body = await req.json()
		if (!body.url || typeof body.url !== 'string') {
			return Response.json(
				{ error: 'Missing url field' },
				{ status: 400, headers },
			)
		}
		await setWebhookUrl(body.url)
		return Response.json({ success: true }, { headers })
	}

	if (path === '/v1/webhook' && method === 'DELETE') {
		await removeWebhookUrl()
		return Response.json({ success: true }, { headers })
	}

	if (path === '/v1/app/focus' && method === 'POST') {
		const body = await req.json()
		setAppFocused(body.focused === true)
		return Response.json({ success: true }, { headers })
	}

	if (path === '/v1/push-tokens' && method === 'POST') {
		const body = await req.json()
		if (!body.token || typeof body.token !== 'string') {
			return Response.json(
				{ error: 'Missing token field' },
				{ status: 400, headers },
			)
		}
		if (!body.token.startsWith('ExponentPushToken[')) {
			return Response.json(
				{ error: 'Invalid Expo push token format' },
				{ status: 400, headers },
			)
		}
		if (body.platform !== 'ios' && body.platform !== 'android') {
			return Response.json(
				{ error: 'Invalid platform, must be ios or android' },
				{ status: 400, headers },
			)
		}
		await addPushToken(body.token, body.platform)
		return Response.json({ success: true }, { headers })
	}

	if (path === '/v1/push-tokens' && method === 'DELETE') {
		const body = await req.json()
		if (!body.token || typeof body.token !== 'string') {
			return Response.json(
				{ error: 'Missing token field' },
				{ status: 400, headers },
			)
		}
		const removed = await removePushToken(body.token)
		return Response.json({ success: removed }, { headers })
	}

	return null
}
