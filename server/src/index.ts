import pkg from '../package.json'
import {
	cloneRepo,
	getGitHubOrgs,
	getGitHubRepos,
	getOrgRepos,
} from './api/github'
import { addRepo, deleteRepo, getRepos, withSetupFile } from './api/repos'
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
} from './api/sessions'
import { cancelSetup, retrySetup, startStep, stopStep } from './api/setup'
import {
	createWorktree,
	deleteWorktree,
	detectEnvVars,
	getWorktrees,
} from './api/worktrees'
import {
	addPushToken,
	getCloneDirectory,
	listDirectories,
	loadConfig,
	log,
	removePushToken,
	saveConfig,
	setLogsEnabled,
} from './config'

export { setLogsEnabled }

import { cleanupStaleSessions } from './terminal/ttyd'

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

export async function startServer(port: number) {
	log('server', 'starting up')
	await cleanupStaleSessions()

	setInterval(async () => {
		await cleanupStaleSessions()
	}, 30000)

	Bun.serve({
		port,
		async fetch(req) {
			const url = new URL(req.url)
			const path = url.pathname
			const method = req.method

			const headers = {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type',
			}

			if (method === 'OPTIONS') {
				return new Response(null, { headers })
			}

			log('http', `${method} ${path}`)

			if (path === '/health' && method === 'GET') {
				return Response.json({ status: 'ok' }, { headers })
			}

			if (path === '/version' && method === 'GET') {
				return Response.json({ version: pkg.version }, { headers })
			}

			if (path === '/update' && method === 'POST') {
				const proc = Bun.spawn(
					['sh', '-c', 'brew update && brew upgrade grove'],
					{
						stdout: 'pipe',
						stderr: 'pipe',
					},
				)
				const exitCode = await proc.exited
				if (exitCode !== 0) {
					const stderr = await new Response(proc.stderr).text()
					return Response.json(
						{ error: stderr || 'Update failed' },
						{ status: 500, headers },
					)
				}
				return Response.json({ success: true }, { headers })
			}

			if (path === '/events' && method === 'GET') {
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

			try {
				if (path === '/repos' && method === 'GET') {
					return Response.json(await getRepos(), { headers })
				}

				if (path === '/repos' && method === 'POST') {
					const body = await req.json()
					const repo = await addRepo(body.path)
					if (typeof repo === 'string') {
						return Response.json({ error: repo }, { status: 400, headers })
					}
					return Response.json(withSetupFile(repo), { headers })
				}

				const repoMatch = matchRoute(path, '/repos/:id')
				if (repoMatch && method === 'DELETE') {
					const deleted = await deleteRepo(repoMatch.id)
					if (typeof deleted === 'string') {
						return Response.json({ error: deleted }, { status: 404, headers })
					}
					return Response.json({ success: true }, { headers })
				}

				const envDetectMatch = matchRoute(path, '/repos/:id/env/scan')
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

				const envMatch = matchRoute(path, '/repos/:id/env')
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

				const setupMatch = matchRoute(path, '/repos/:id/setup')
				if (setupMatch && method === 'GET') {
					const config = await loadConfig()
					const repo = config.repos.find(r => r.id === setupMatch.id)
					if (!repo) {
						return Response.json(
							{ error: 'Repo not found' },
							{ status: 404, headers },
						)
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
						return Response.json(
							{ error: 'Invalid index' },
							{ status: 400, headers },
						)
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
						return Response.json(
							{ error: 'Missing index' },
							{ status: 400, headers },
						)
					}
					if (
						!repo.setupSteps ||
						body.index < 0 ||
						body.index >= repo.setupSteps.length
					) {
						return Response.json(
							{ error: 'Invalid index' },
							{ status: 400, headers },
						)
					}
					repo.setupSteps.splice(body.index, 1)
					if (repo.setupSteps.length === 0) repo.setupSteps = undefined
					await saveConfig(config)
					return Response.json(repo.setupSteps ?? [], { headers })
				}

				const setupReorderMatch = matchRoute(path, '/repos/:id/setup/reorder')
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
							{
								error: 'order must be a permutation of current indices',
							},
							{ status: 400, headers },
						)
					}
					repo.setupSteps = body.order.map((i: number) => steps[i])
					await saveConfig(config)
					return Response.json(repo.setupSteps, { headers })
				}

				const orgReposMatch = matchRoute(path, '/github/repos/orgs/:org')
				if (orgReposMatch && method === 'GET') {
					return Response.json(
						{ repos: await getOrgRepos(orgReposMatch.org) },
						{ headers },
					)
				}

				if (path === '/github/repos/orgs' && method === 'GET') {
					return Response.json({ orgs: await getGitHubOrgs() }, { headers })
				}

				if (path === '/github/repos' && method === 'GET') {
					return Response.json({ repos: await getGitHubRepos() }, { headers })
				}

				if (path === '/repos/clone' && method === 'POST') {
					const body = await req.json()
					const repo = await cloneRepo(body.fullName)
					if (typeof repo === 'string') {
						return Response.json({ error: repo }, { status: 400, headers })
					}
					return Response.json(withSetupFile(repo), { headers })
				}

				if (path === '/sessions' && method === 'GET') {
					return Response.json(await getSessions(), { headers })
				}

				if (path === '/sessions' && method === 'POST') {
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

				const sessionMatch = matchRoute(path, '/sessions/:id')
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

				const focusMatch = matchRoute(path, '/sessions/:id/focus')
				if (focusMatch && method === 'POST') {
					setSessionFocused(focusMatch.id)
					return Response.json({ success: true }, { headers })
				}
				if (focusMatch && method === 'DELETE') {
					clearSessionFocused(focusMatch.id)
					return Response.json({ success: true }, { headers })
				}

				const setupRetryMatch = matchRoute(path, '/sessions/:id/setup/retry')
				if (setupRetryMatch && method === 'POST') {
					await retrySetup(setupRetryMatch.id)
					return Response.json({ success: true }, { headers })
				}

				const setupCancelMatch = matchRoute(path, '/sessions/:id/setup/cancel')
				if (setupCancelMatch && method === 'POST') {
					cancelSetup(setupCancelMatch.id)
					return Response.json({ success: true }, { headers })
				}

				const setupStopMatch = matchRoute(path, '/sessions/:id/setup/stop')
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

				const setupStartMatch = matchRoute(path, '/sessions/:id/setup/start')
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

				const behindMainMatch = matchRoute(path, '/sessions/:id/behind-main')
				if (behindMainMatch && method === 'GET') {
					const behind = await getBehindMain(behindMainMatch.id)
					if (typeof behind === 'string') {
						return Response.json({ error: behind }, { status: 404, headers })
					}
					return Response.json({ behind }, { headers })
				}

				const mergeMainMatch = matchRoute(path, '/sessions/:id/merge-main')
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
						return Response.json(
							{ error: result.error },
							{ status: 400, headers },
						)
					}
					return Response.json({ success: true }, { headers })
				}

				const createPRMatch = matchRoute(path, '/sessions/:id/create-pr')
				if (createPRMatch && method === 'POST') {
					const result = await createPR(createPRMatch.id)
					if (!result.success) {
						return Response.json(
							{ error: result.error },
							{ status: 400, headers },
						)
					}
					return Response.json({ url: result.url }, { headers })
				}

				const uploadMatch = matchRoute(path, '/sessions/:id/upload')
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

				const worktreeMatch = matchRoute(path, '/worktrees/:repoId')
				if (worktreeMatch && method === 'GET') {
					const worktrees = await getWorktrees(worktreeMatch.repoId)
					return Response.json(worktrees, { headers })
				}

				if (path === '/worktrees' && method === 'POST') {
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

				if (path === '/worktrees' && method === 'DELETE') {
					const body = await req.json()
					const deleted = await deleteWorktree(
						body.repoId,
						body.branch,
						body.force,
					)
					if (typeof deleted === 'string') {
						return Response.json({ error: deleted }, { status: 400, headers })
					}
					return Response.json({ success: true }, { headers })
				}

				if (path === '/config/list-directories' && method === 'GET') {
					const queryPath = url.searchParams.get('path') ?? '/'
					const dirs = listDirectories(queryPath)
					return Response.json({ directories: dirs }, { headers })
				}

				if (path === '/config/clone-directory' && method === 'GET') {
					const dir = await getCloneDirectory()
					return Response.json({ cloneDirectory: dir }, { headers })
				}

				if (path === '/config/clone-directory' && method === 'PUT') {
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
					return Response.json(
						{ cloneDirectory: body.cloneDirectory },
						{ headers },
					)
				}

				if (path === '/webhook' && method === 'GET') {
					const url = await getWebhookUrl()
					return Response.json({ webhookUrl: url ?? null }, { headers })
				}

				if (path === '/webhook' && method === 'POST') {
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

				if (path === '/webhook' && method === 'DELETE') {
					await removeWebhookUrl()
					return Response.json({ success: true }, { headers })
				}

				if (path === '/app/focus' && method === 'POST') {
					const body = await req.json()
					setAppFocused(body.focused === true)
					return Response.json({ success: true }, { headers })
				}

				if (path === '/push-tokens' && method === 'POST') {
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
					log('push', 'registered token', { platform: body.platform })
					return Response.json({ success: true }, { headers })
				}

				if (path === '/push-tokens' && method === 'DELETE') {
					const body = await req.json()
					if (!body.token || typeof body.token !== 'string') {
						return Response.json(
							{ error: 'Missing token field' },
							{ status: 400, headers },
						)
					}
					const removed = await removePushToken(body.token)
					log('push', 'removed token', { removed })
					return Response.json({ success: removed }, { headers })
				}

				return Response.json({ error: 'Not found' }, { status: 404, headers })
			} catch (e) {
				const err =
					e instanceof Error ? { message: e.message, stack: e.stack } : e
				log('http', 'error', err)
				return Response.json(
					{ error: 'Internal server error' },
					{ status: 500, headers },
				)
			}
		},
	})

	log('server', `listening on http://localhost:${port}`)
}

if (import.meta.main) {
	const isDev = Bun.env.NODE_ENV === 'development'
	const port = Number(Bun.env.PORT) || (isDev ? 4002 : 4001)
	startServer(port)
}
