import { addRepo, deleteRepo, getRepos } from './api/repos'
import { createSession, deleteSession, getSessions } from './api/sessions'
import { createWorktree, getWorktrees } from './api/worktrees'
import { cleanupStaleSessions } from './terminal/ttyd'

const PORT = Bun.env.PORT || 3000

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

		console.log(`${method} ${path}`)

		try {
			if (path === '/repos' && method === 'GET') {
				return Response.json(await getRepos(), { headers })
			}

			if (path === '/repos' && method === 'POST') {
				const body = await req.json()
				console.log('Adding repo:', body.path)
				const repo = await addRepo(body.path)
				if (!repo) {
					console.log('Failed to add repo - invalid path')
					return Response.json(
						{ error: 'Invalid repo path' },
						{ status: 400, headers },
					)
				}
				console.log('Repo added:', repo)
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
				const session = await createSession(body.repoId, body.worktree)
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

			return Response.json({ error: 'Not found' }, { status: 404, headers })
		} catch (e) {
			console.error(e)
			return Response.json(
				{ error: 'Internal server error' },
				{ status: 500, headers },
			)
		}
	},
})

console.log(`Klaude server running on http://localhost:${PORT}`)
