import { addRepo, deleteRepo, getRepos } from './api/repos'
import {
	addSSEClient,
	createSession,
	deleteSession,
	getSessions,
	removeSSEClient,
} from './api/sessions'
import { createWorktree, deleteWorktree, getWorktrees } from './api/worktrees'
import { log } from './config'
import { cleanupStaleSessions } from './terminal/ttyd'

const PORT = Bun.env.PORT || 3001

log('server', 'starting up')
await cleanupStaleSessions()

Bun.serve({
	port: PORT,
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

		if (path === '/events' && method === 'GET') {
			const stream = new ReadableStream({
				start(controller) {
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

			if (path.startsWith('/repos/') && method === 'DELETE') {
				const id = path.split('/')[2]
				const deleted = await deleteRepo(id)
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

			if (path.startsWith('/sessions/') && method === 'DELETE') {
				const id = path.split('/')[2]
				const deleted = await deleteSession(id)
				if (!deleted) {
					return Response.json(
						{ error: 'Session not found' },
						{ status: 404, headers },
					)
				}
				return Response.json({ success: true }, { headers })
			}

			if (path.startsWith('/worktrees/') && method === 'GET') {
				const repoId = path.split('/')[2]
				const worktrees = await getWorktrees(repoId)
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
				const deleted = await deleteWorktree(body.repoId, body.branch)
				if (!deleted) {
					return Response.json(
						{ error: 'Failed to delete worktree' },
						{ status: 400, headers },
					)
				}
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

log('server', `listening on http://localhost:${PORT}`)
