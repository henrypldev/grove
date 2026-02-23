import pkg from '../package.json'
import { onNewTeam, startOrchestrator } from './agents/orchestrator'
import { log, setLogsEnabled } from './config'
import { getDb } from './db'
import { handleV1 } from './routes/v1'
import { handleV2Dashboard } from './routes/v2/dashboard'
import { handleV2Events } from './routes/v2/events'
import { handleV2Repos } from './routes/v2/repos'
import { handleV2Teams, setTeamCreatedHook } from './routes/v2/teams'
import { cleanupStaleSessions } from './terminal/ttyd'
import { startEventPoller, wsHandlers } from './websocket'

export { setLogsEnabled }

export async function startServer(port: number) {
	getDb()
	await startOrchestrator()
	setTeamCreatedHook(onNewTeam)
	log('server', 'starting up')
	await cleanupStaleSessions()
	startEventPoller()

	setInterval(async () => {
		await cleanupStaleSessions()
	}, 30000)

	Bun.serve({
		port,
		websocket: wsHandlers,
		async fetch(req, server) {
			const url = new URL(req.url)
			const path = url.pathname
			const method = req.method

			const headers = {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type',
			}

			if (path === '/ws') {
				const upgraded = server.upgrade(req, { data: { clientId: '' } })
				if (upgraded) return undefined
				return new Response('WebSocket upgrade failed', { status: 400 })
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

			try {
				const v2ReposResponse = await handleV2Repos(req, url, headers)
				if (v2ReposResponse) return v2ReposResponse

				const v2DashboardResponse = await handleV2Dashboard(req, url, headers)
				if (v2DashboardResponse) return v2DashboardResponse

				const v2TeamsResponse = await handleV2Teams(req, url, headers)
				if (v2TeamsResponse) return v2TeamsResponse

				const v2EventsResponse = await handleV2Events(req, url, headers)
				if (v2EventsResponse) return v2EventsResponse

				const v1Response = await handleV1(req, url, headers)
				if (v1Response) return v1Response

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
