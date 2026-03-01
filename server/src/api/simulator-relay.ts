import type { ServerWebSocket } from 'bun'
import { log } from '../config'

const SIMULATOR_BINARY =
	process.env.GROVE_SIMULATOR_BINARY ||
	`${process.env.HOME}/Projects/grove-desktop/simulator-server/.build/release/GroveSimulatorServer`

interface SimulatorProcess {
	proc: ReturnType<typeof Bun.spawn>
	port: number
	refCount: number
	releaseTimer: ReturnType<typeof setTimeout> | null
	upstreamWs: WebSocket | null
	upstreamReady: Promise<void> | null
	clients: Set<ServerWebSocket<SimulatorWsData>>
}

export interface SimulatorWsData {
	type: 'simulator'
	clientId: string
}

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

async function spawnSimulator(): Promise<SimulatorProcess> {
	if (sim) return sim

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
	}

	sim = entry
	return entry
}

function teardown() {
	if (!sim) return
	log('simulator-relay', 'tearing down GroveSimulatorServer')
	try {
		sim.upstreamWs?.close()
	} catch {}
	try {
		sim.proc.kill()
	} catch {}
	sim = null
}

function connectUpstream(entry: SimulatorProcess): Promise<void> {
	if (entry.upstreamReady) return entry.upstreamReady

	entry.upstreamReady = new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${entry.port}`)
		ws.binaryType = 'arraybuffer'

		ws.onopen = () => {
			entry.upstreamWs = ws
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
				} catch {}
			}
		}

		ws.onclose = () => {
			entry.upstreamWs = null
			entry.upstreamReady = null
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
			} catch {}
		})
		.catch(() => {})
}

export function handleSimulatorClose(ws: ServerWebSocket<SimulatorWsData>) {
	if (!sim) return
	sim.clients.delete(ws)
	sim.refCount = Math.max(0, sim.refCount - 1)
	log('simulator-relay', `client disconnected (refCount=${sim.refCount})`)

	if (sim.refCount === 0) {
		sim.releaseTimer = setTimeout(() => {
			if (sim && sim.refCount === 0) {
				teardown()
			}
		}, 2000)
	}
}
