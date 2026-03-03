import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ServerWebSocket } from 'bun'
import { log } from '../config'
import { hasActiveSimulators } from './simulator'

function resolveSimulatorBinary(): string {
	if (process.env.GROVE_SIMULATOR_BINARY)
		return process.env.GROVE_SIMULATOR_BINARY

	// Installed: <prefix>/bin/grove + <prefix>/libexec/GroveSimulatorServer
	const installed = join(
		dirname(process.execPath),
		'..',
		'libexec',
		'GroveSimulatorServer',
	)
	if (existsSync(installed)) return installed

	// Co-located: same directory as the grove binary
	const colocated = join(dirname(process.execPath), 'GroveSimulatorServer')
	if (existsSync(colocated)) return colocated

	// Dev: in-repo build output
	return new URL(
		'../../../simulator-server/.build/release/GroveSimulatorServer',
		import.meta.url,
	).pathname
}

const SIMULATOR_BINARY = resolveSimulatorBinary()
const MAX_RECONNECT_ATTEMPTS = 3

interface SimulatorProcess {
	proc: ReturnType<typeof Bun.spawn>
	port: number
	refCount: number
	releaseTimer: ReturnType<typeof setTimeout> | null
	upstreamWs: WebSocket | null
	upstreamReady: Promise<void> | null
	clients: Set<ServerWebSocket<SimulatorWsData>>
	reconnectAttempts: number
}

export interface SimulatorWsData {
	type: 'simulator'
	clientId: string
}

/** Max incoming message size from clients (1MB) */
export const SIMULATOR_MAX_PAYLOAD = 1024 * 1024

let sim: SimulatorProcess | null = null
let initPromise: Promise<void> | null = null

function findFreePort(): number {
	return 9876 + Math.floor(Math.random() * 1000)
}

async function ensureReady(): Promise<void> {
	if (sim?.upstreamWs?.readyState === WebSocket.OPEN) return
	if (initPromise) return initPromise

	initPromise = (async () => {
		try {
			const entry = await spawnSimulator()
			await connectUpstream(entry)
		} finally {
			initPromise = null
		}
	})()

	return initPromise
}

async function killExistingSimulators(): Promise<void> {
	try {
		const result = Bun.spawnSync(['pkill', '-f', 'GroveSimulatorServer'])
		if (result.exitCode === 0) {
			log('simulator-relay', 'killed existing GroveSimulatorServer process(es)')
			// Brief wait for port release
			await new Promise(r => setTimeout(r, 300))
		}
	} catch {}
}

async function spawnSimulator(): Promise<SimulatorProcess> {
	if (sim) return sim

	await killExistingSimulators()

	const port = findFreePort()
	log('simulator-relay', `spawning GroveSimulatorServer on port ${port}`)

	const proc = Bun.spawn([SIMULATOR_BINARY, String(port)], {
		stdout: 'pipe',
		stderr: 'pipe',
	})

	// Swift buffers stdout when not a TTY, so poll the port instead
	const deadline = Date.now() + 5000
	let ready = false
	while (Date.now() < deadline) {
		try {
			const sock = await Bun.connect({
				hostname: '127.0.0.1',
				port,
				socket: {
					data() {},
					open(s) {
						s.end()
					},
					error() {},
					close() {},
				},
			})
			sock.end()
			ready = true
			break
		} catch {
			await new Promise(r => setTimeout(r, 100))
		}
	}

	if (!ready) {
		proc.kill()
		throw new Error('GroveSimulatorServer failed to start')
	}

	log('simulator-relay', `process ready on port ${port}`)

	const entry: SimulatorProcess = {
		proc,
		port,
		refCount: 0,
		releaseTimer: null,
		upstreamWs: null,
		upstreamReady: null,
		clients: new Set(),
		reconnectAttempts: 0,
	}

	sim = entry
	return entry
}

function teardown() {
	if (!sim) return
	log('simulator-relay', 'tearing down GroveSimulatorServer')
	try {
		sim.upstreamWs?.close()
	} catch (err) {
		log('simulator-relay', `teardown: error closing upstream ws: ${err}`)
	}
	try {
		sim.proc.kill()
	} catch (err) {
		log('simulator-relay', `teardown: error killing process: ${err}`)
	}
	sim = null
}

function connectUpstream(entry: SimulatorProcess): Promise<void> {
	if (entry.upstreamReady) return entry.upstreamReady

	entry.upstreamReady = new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${entry.port}`)
		ws.binaryType = 'arraybuffer'

		ws.onopen = () => {
			entry.upstreamWs = ws
			entry.reconnectAttempts = 0
			log('simulator-relay', 'upstream connected')
			resolve()
		}

		ws.onmessage = event => {
			for (const client of entry.clients) {
				try {
					if (event.data instanceof ArrayBuffer) {
						client.send(event.data)
					} else {
						client.send(event.data as string)
					}
				} catch (err) {
					log('simulator-relay', `error sending to client: ${err}`)
					entry.clients.delete(client)
				}
			}
		}

		ws.onclose = () => {
			entry.upstreamWs = null
			entry.upstreamReady = null

			// Auto-reconnect if clients are still connected
			if (
				entry.clients.size > 0 &&
				entry.reconnectAttempts < MAX_RECONNECT_ATTEMPTS
			) {
				entry.reconnectAttempts++
				log(
					'simulator-relay',
					`upstream closed unexpectedly, reconnecting (attempt ${entry.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`,
				)
				teardown()
				ensureReady().catch(err => {
					log('simulator-relay', `reconnection failed: ${err}`)
				})
			}
		}

		ws.onerror = () => {
			entry.upstreamReady = null
			reject(new Error('Failed to connect to simulator server'))
		}
	})

	return entry.upstreamReady
}

export function handleSimulatorOpen(ws: ServerWebSocket<SimulatorWsData>) {
	// Start init in background — don't block Bun's open handler
	ensureReady()
		.then(() => {
			if (!sim) return
			sim.refCount++
			if (sim.releaseTimer) {
				clearTimeout(sim.releaseTimer)
				sim.releaseTimer = null
			}
			sim.clients.add(ws)
			log('simulator-relay', `client connected (refCount=${sim.refCount})`)
		})
		.catch(err => {
			log('simulator-relay', `error: ${err}`)
			ws.close(1011, 'Failed to start simulator server')
		})
}

export function handleSimulatorMessage(
	_ws: ServerWebSocket<SimulatorWsData>,
	data: string | Buffer,
) {
	// Wait for upstream to be ready, then forward
	ensureReady()
		.then(() => {
			if (!sim?.upstreamWs) return
			try {
				sim.upstreamWs.send(data)
			} catch (err) {
				log('simulator-relay', `error forwarding message upstream: ${err}`)
			}
		})
		.catch(err => {
			log('simulator-relay', `error in handleSimulatorMessage: ${err}`)
		})
}

export function handleSimulatorClose(ws: ServerWebSocket<SimulatorWsData>) {
	if (!sim) return
	sim.clients.delete(ws)
	sim.refCount = Math.max(0, sim.refCount - 1)
	log('simulator-relay', `client disconnected (refCount=${sim.refCount})`)

	if (sim.refCount === 0 && !hasActiveSimulators()) {
		sim.releaseTimer = setTimeout(() => {
			if (sim && sim.refCount === 0 && !hasActiveSimulators()) {
				teardown()
			}
		}, 2000)
	}
}
