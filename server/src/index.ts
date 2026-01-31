import {
	cloneRepo,
	getGitHubOrgs,
	getGitHubRepos,
	getOrgRepos,
} from './api/github'
import { addRepo, deleteRepo, getRepos } from './api/repos'
import {
	addSSEClient,
	createPR,
	createSession,
	deleteSession,
	getBehindMain,
	getSessions,
	getWebhookUrl,
	mergeMain,
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
					if (typeof repo === 'string') {
						return Response.json({ error: repo }, { status: 400, headers })
					}
					return Response.json(repo, { headers })
				}

				const repoMatch = matchRoute(path, '/repos/:id')
				if (repoMatch && method === 'DELETE') {
					const deleted = await deleteRepo(repoMatch.id)
					if (typeof deleted === 'string') {
						return Response.json({ error: deleted }, { status: 404, headers })
					}
					return Response.json({ success: true }, { headers })
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
					return Response.json(repo, { headers })
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
	const port = Number(Bun.env.PORT) || 4001
	startServer(port)
}
