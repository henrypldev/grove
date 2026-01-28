import { addRepo, deleteRepo, getRepos } from './api/repos'
import {
	addSSEClient,
	createSession,
	deleteSession,
	getSessions,
	getWebhookUrl,
	removeSSEClient,
	removeWebhookUrl,
	setWebhookUrl,
} from './api/sessions'
import { createWorktree, deleteWorktree, getWorktrees } from './api/worktrees'
import { log, setLogsEnabled } from './config'

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
				'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type',
			}

			if (method === 'OPTIONS') {
				return new Response(null, { headers })
			}

			log('http', `${method} ${path}`)

			if (path === '/health' && method === 'GET') {
				return Response.json({ status: 'ok' }, { headers })
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
					if (!repo) {
						return Response.json(
							{ error: 'Invalid repo path' },
							{ status: 400, headers },
						)
					}
					return Response.json(repo, { headers })
				}

				const repoMatch = matchRoute(path, '/repos/:id')
				if (repoMatch && method === 'DELETE') {
					const deleted = await deleteRepo(repoMatch.id)
					if (!deleted) {
						return Response.json(
							{ error: 'Repo not found' },
							{ status: 404, headers },
						)
					}
					return Response.json({ success: true }, { headers })
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
					if (!session) {
						return Response.json(
							{ error: 'Failed to create session' },
							{ status: 400, headers },
						)
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
					if (!worktree) {
						return Response.json(
							{ error: 'Failed to create worktree' },
							{ status: 400, headers },
						)
					}
					return Response.json(worktree, { headers })
				}

				if (path === '/worktrees' && method === 'DELETE') {
					const body = await req.json()
					const deleted = await deleteWorktree(body.repoId, body.branch, body.force)
					if (!deleted) {
						return Response.json(
							{ error: 'Failed to delete worktree' },
							{ status: 400, headers },
						)
					}
					return Response.json({ success: true }, { headers })
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

				return Response.json({ error: 'Not found' }, { status: 404, headers })
			} catch (e) {
				log('http', 'error', e)
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
	const port = Number(Bun.env.PORT) || 3001
	startServer(port)
}
