import { log } from '../config'
import { emitTeamLog } from '../db/logs'
import { isPortListening, killProcessOnPort } from './ports'

type ExpoDevServerStatus = 'starting' | 'running' | 'stopped' | 'failed'

interface ActiveDevServer {
	teamId: string
	worktreePath: string
	port: number
	process: ReturnType<typeof Bun.spawn> | null
	output: string
	status: ExpoDevServerStatus
}

const activeDevServers = new Map<string, ActiveDevServer>()

function emitOutput(teamId: string, chunk: string) {
	emitTeamLog(teamId, 'expo_dev_server_output', { chunk })
}

function emitProgress(teamId: string, status: string) {
	emitTeamLog(teamId, 'expo_dev_server', { status })
}

async function streamOutput(
	stream: ReadableStream<Uint8Array>,
	server: ActiveDevServer,
) {
	const reader = stream.getReader()
	const decoder = new TextDecoder()
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			const text = decoder.decode(value, { stream: true })
			server.output += text
			emitOutput(server.teamId, text)
		}
	} finally {
		reader.releaseLock()
	}
}

export async function startExpoDevServer(
	teamId: string,
	worktreePath: string,
	port: number,
) {
	const existing = activeDevServers.get(teamId)
	if (existing) {
		if (existing.status === 'running' || existing.status === 'starting') {
			log('expo-dev-server', 'already running', { teamId })
			return
		}
	}

	// Kill any leftover process on this port before starting
	if (await isPortListening(port)) {
		log('expo-dev-server', 'port already in use, killing leftover process', {
			teamId,
			port,
		})
		await killProcessOnPort(port)
	}

	const command = `bunx expo start --port ${port}`
	const proc = Bun.spawn(['sh', '-c', command], {
		cwd: worktreePath,
		stdout: 'pipe',
		stderr: 'pipe',
		detached: true,
		env: {
			...process.env,
			REACT_NATIVE_PACKAGER_HOSTNAME: 'localhost',
		},
	})

	const server: ActiveDevServer = {
		teamId,
		worktreePath,
		port,
		process: proc,
		output: '',
		status: 'starting',
	}

	activeDevServers.set(teamId, server)
	log('expo-dev-server', 'starting', { teamId, port })
	emitProgress(teamId, 'starting')

	Promise.all([
		streamOutput(proc.stdout, server),
		streamOutput(proc.stderr, server),
	]).catch(err => {
		log('expo-dev-server', 'stream error', {
			teamId,
			error: err?.message ?? err,
		})
	})

	// Monitor for port becoming active → mark as running
	const pollId = setInterval(async () => {
		const s = activeDevServers.get(teamId)
		if (!s || s.status !== 'starting') {
			clearInterval(pollId)
			return
		}
		if (await isPortListening(port)) {
			s.status = 'running'
			log('expo-dev-server', 'running', { teamId, port })
			emitProgress(teamId, 'running')
			clearInterval(pollId)
		}
	}, 1000)

	proc.exited.then(exitCode => {
		clearInterval(pollId)
		const s = activeDevServers.get(teamId)
		if (!s || s.status === 'stopped') return

		s.process = null
		s.status = 'failed'
		log('expo-dev-server', 'exited unexpectedly', { teamId, exitCode })
		emitProgress(teamId, 'failed')
	})
}

export function stopExpoDevServer(teamId: string) {
	const server = activeDevServers.get(teamId)
	if (!server) return

	const port = server.port

	if (server.process) {
		const pid = server.process.pid
		try {
			process.kill(-pid, 'SIGTERM')
		} catch {
			try {
				server.process.kill()
			} catch {}
		}
	}

	// Also kill anything still listening on the port
	killProcessOnPort(port)

	server.status = 'stopped'
	server.process = null
	emitProgress(teamId, 'stopped')
	activeDevServers.delete(teamId)
	log('expo-dev-server', 'stopped', { teamId })
}

export function killAllExpoDevServers() {
	for (const teamId of activeDevServers.keys()) {
		stopExpoDevServer(teamId)
	}
}

export function getExpoDevServerStatus(
	teamId: string,
): ExpoDevServerStatus | null {
	return activeDevServers.get(teamId)?.status ?? null
}

export function getExpoDevServerOutput(teamId: string): string | null {
	return activeDevServers.get(teamId)?.output ?? null
}

const KEY_TO_METRO_METHOD: Record<string, string> = {
	r: 'reload',
	m: 'devMenu',
}

export async function sendExpoDevServerCommand(
	teamId: string,
	key: string,
): Promise<boolean> {
	const server = activeDevServers.get(teamId)
	if (!server || server.status !== 'running') return false

	const method = KEY_TO_METRO_METHOD[key]
	if (!method) {
		log('expo-dev-server', 'unknown key', { teamId, key })
		return false
	}

	log('expo-dev-server', 'command', { teamId, key, method })

	return new Promise<boolean>(resolve => {
		let ws: WebSocket | null = null
		let resolved = false
		const done = (result: boolean) => {
			if (resolved) return
			resolved = true
			clearTimeout(timeout)
			try {
				ws?.close()
			} catch {}
			resolve(result)
		}
		const timeout = setTimeout(() => done(false), 5000)

		try {
			ws = new WebSocket(`ws://localhost:${server.port}/message`)
			ws.onopen = () => {
				ws?.send(JSON.stringify({ version: 2, method }))
				done(true)
			}
			ws.onerror = () => done(false)
			ws.onclose = () => done(false)
		} catch {
			done(false)
		}
	})
}

export async function waitForDevServerReady(
	teamId: string,
	timeoutMs = 30000,
): Promise<boolean> {
	const server = activeDevServers.get(teamId)
	if (!server) return false
	if (server.status === 'running') return true

	return new Promise<boolean>(resolve => {
		const start = Date.now()
		const check = setInterval(() => {
			const s = activeDevServers.get(teamId)
			if (!s || s.status === 'failed' || s.status === 'stopped') {
				clearInterval(check)
				resolve(false)
				return
			}
			if (s.status === 'running') {
				clearInterval(check)
				resolve(true)
				return
			}
			if (Date.now() - start > timeoutMs) {
				clearInterval(check)
				log('expo-dev-server', 'wait timed out', { teamId, timeoutMs })
				resolve(false)
			}
		}, 500)
	})
}
