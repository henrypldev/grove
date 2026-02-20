import pkg from '../package.json'
import { log, setLogsEnabled } from './config'
import { handleV1 } from './routes/v1'
import { cleanupStaleSessions } from './terminal/ttyd'

export { setLogsEnabled }

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
				const proc = Bun.spawn(['sh', '-c', 'brew update && brew upgrade grove'], {
					stdout: 'pipe',
					stderr: 'pipe',
				})
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
				const v1Response = await handleV1(req, url, headers)
				if (v1Response) return v1Response

				return Response.json({ error: 'Not found' }, { status: 404, headers })
			} catch (e) {
				const err = e instanceof Error ? { message: e.message, stack: e.stack } : e
				log('http', 'error', err)
				return Response.json({ error: 'Internal server error' }, { status: 500, headers })
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
