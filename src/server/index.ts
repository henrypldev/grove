import pkg from '../../package.json'
import { onNewTeam, startOrchestrator } from './agents/orchestrator'
import { killAllExpoBuilds } from './api/expo-build'
import { killAllExpoDevServers } from './api/expo-dev-server'
import { startPortPoller } from './api/ports'
import { getTailscaleId, getTerminalHost, log, setLogsEnabled } from './config'
import { getDb } from './db'
import { handleV2Activity } from './routes/v2/activity'
import { handleV2Dashboard } from './routes/v2/dashboard'
import { handleV2Repos } from './routes/v2/repos'
import { handleV2Teams, setTeamCreatedHook } from './routes/v2/teams'
import { handleV2Usage } from './routes/v2/usage'
import { cleanupStaleSessions } from './terminal/ttyd'
import { initWebSocketBridge, wsHandlers } from './websocket'

export { setLogsEnabled }

export async function startServer(port: number): Promise<number> {
	getDb()
	await getTerminalHost()
	await startOrchestrator()
	setTeamCreatedHook(onNewTeam)
	log('server', 'starting up')
	await cleanupStaleSessions()
	initWebSocketBridge()
	startPortPoller()

	setInterval(async () => {
		await cleanupStaleSessions()
	}, 30000)

	const server = Bun.serve({
		port,
		websocket: wsHandlers,
		async fetch(req, server) {
			const url = new URL(req.url)
			const path = url.pathname.replace(/\/+$/, '') || '/'
			const method = req.method

			const headers = {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods':
					'GET, POST, PUT, PATCH, DELETE, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type',
			}

			if (path === '/ws') {
				const upgraded = server.upgrade(req, { data: { clientId: '' } })
				if (upgraded) return undefined
				return new Response('WebSocket upgrade failed', { status: 400 })
			}

			if (path === '/v2/simulator/ws') {
				const deviceId = url.searchParams.get('deviceId')
				const upgraded = server.upgrade(req, {
					data: { type: 'simulator' as const, clientId: '', deviceId },
				})
				if (upgraded) return undefined
				return new Response('WebSocket upgrade failed', { status: 400 })
			}

			if (method === 'OPTIONS') {
				return new Response(null, { headers })
			}

			if (path === '/health' && method === 'GET') {
				return logResponse(Response.json({ status: 'ok' }, { headers }))
			}

			if (path === '/version' && method === 'GET') {
				return logResponse(Response.json({ version: pkg.version }, { headers }))
			}

			if (path === '/v2/identity' && method === 'GET') {
				const tailscaleId = getTailscaleId()
				return logResponse(Response.json({ tailscaleId }, { headers }))
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
					return logResponse(
						Response.json(
							{ error: stderr || 'Update failed' },
							{ status: 500, headers },
						),
					)
				}
				return logResponse(Response.json({ success: true }, { headers }))
			}

			try {
				const v2ReposResponse = await handleV2Repos(req, url, headers)
				if (v2ReposResponse) return logResponse(v2ReposResponse)

				const v2DashboardResponse = await handleV2Dashboard(req, url, headers)
				if (v2DashboardResponse) return logResponse(v2DashboardResponse)

				const v2UsageResponse = await handleV2Usage(req, url, headers)
				if (v2UsageResponse) return logResponse(v2UsageResponse)

				const v2TeamsResponse = await handleV2Teams(req, url, headers)
				if (v2TeamsResponse) return logResponse(v2TeamsResponse)

				const v2ActivityResponse = await handleV2Activity(req, url, headers)
				if (v2ActivityResponse) return logResponse(v2ActivityResponse)

				return logResponse(
					Response.json({ error: 'Not found' }, { status: 404, headers }),
				)
			} catch (e) {
				const err =
					e instanceof Error ? { message: e.message, stack: e.stack } : e
				log('http', 'error', err)
				return logResponse(
					Response.json(
						{ error: 'Internal server error' },
						{ status: 500, headers },
					),
				)
			}

			function logResponse(response: Response) {
				log('http', `${method} ${path} ${response.status}`)
				return response
			}
		},
	})

	const actualPort = server.port
	log('server', `listening on http://localhost:${actualPort}`)

	function shutdown() {
		log('server', 'shutting down, killing child processes')
		killAllExpoBuilds()
		killAllExpoDevServers()
		process.exit(0)
	}

	process.on('SIGTERM', shutdown)
	process.on('SIGINT', shutdown)

	return actualPort
}

if (import.meta.main) {
	const isDev = Bun.env.GROVE_DEV === '1'
	const port = Number(Bun.env.PORT) || (isDev ? 4000 : 0)
	startServer(port)
}
