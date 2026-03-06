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
	clientsByDevice: Map<string, Set<ServerWebSocket<SimulatorWsData>>>
	reconnectAttempts: number
	/** Last frame received per device, sent immediately to new clients */
	lastFrame: Map<string, ArrayBuffer>
	/** Last booted message per device, replayed to new clients */
	lastBooted: Map<string, string>
	/** Tracks which devices have been sent a boot command */
	bootedDevices: Set<string>
}

export interface SimulatorWsData {
	type: 'simulator'
	clientId: string
	deviceId: string | null
}

/** Max incoming message size from clients (1MB) */
export const SIMULATOR_MAX_PAYLOAD = 1024 * 1024

const textDecoder = new TextDecoder()
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
		clientsByDevice: new Map(),
		reconnectAttempts: 0,
		lastFrame: new Map(),
		lastBooted: new Map(),
		bootedDevices: new Set(),
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
			if (event.data instanceof ArrayBuffer) {
				// Parse deviceId prefix: [2-byte BE length][deviceId UTF-8][JPEG data]
				const buf = event.data
				if (buf.byteLength < 2) return
				const view = new DataView(buf)
				const idLen = view.getUint16(0)
				if (buf.byteLength < 2 + idLen) return
				const deviceId = textDecoder.decode(buf.slice(2, 2 + idLen))
				const frameView = new Uint8Array(buf, 2 + idLen)

				// Cache a copy per device (underlying buffer may be reused)
				entry.lastFrame.set(deviceId, buf.slice(2 + idLen))

				// Forward to clients subscribed to this device
				const deviceClients = entry.clientsByDevice.get(deviceId)
				if (deviceClients) {
					for (const client of deviceClients) {
						try {
							client.send(frameView)
						} catch (err) {
							log('simulator-relay', `error sending to client: ${err}`)
							entry.clients.delete(client)
							deviceClients.delete(client)
						}
					}
				}
				// Also send to clients with no deviceId (they receive all frames)
				const nullClients = entry.clientsByDevice.get('')
				if (nullClients) {
					for (const client of nullClients) {
						try {
							client.send(frameView)
						} catch (err) {
							log('simulator-relay', `error sending to client: ${err}`)
							entry.clients.delete(client)
							nullClients.delete(client)
						}
					}
				}
			} else {
				// Cache booted messages per device
				const text = event.data as string
				try {
					const msg = JSON.parse(text)
					if (msg.type === 'booted' && msg.deviceId) {
						entry.lastBooted.set(msg.deviceId, text)
						entry.bootedDevices.add(msg.deviceId)
						log('simulator-relay', `device ${msg.deviceId} booted`)
					} else if (msg.type === 'error') {
						log('simulator-relay', `upstream error: ${msg.message}`)
					}
				} catch (err) {
					log('simulator-relay', `failed to parse upstream message: ${err}`)
				}
				// Forward text messages to all clients (they filter by deviceId themselves)
				for (const client of entry.clients) {
					try {
						client.send(event.data as string)
					} catch (err) {
						log('simulator-relay', `error sending to client: ${err}`)
						entry.clients.delete(client)
					}
				}
			}
		}

		ws.onclose = () => {
			entry.upstreamWs = null
			entry.upstreamReady = null
			// Swift server stops all streams on connection close,
			// so clear cached state to force re-boot on reconnect
			entry.bootedDevices.clear()
			entry.lastBooted.clear()
			entry.lastFrame.clear()

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
			// Index client by deviceId (use '' for null deviceId)
			const deviceKey = ws.data.deviceId ?? ''
			let deviceSet = sim.clientsByDevice.get(deviceKey)
			if (!deviceSet) {
				deviceSet = new Set()
				sim.clientsByDevice.set(deviceKey, deviceSet)
			}
			deviceSet.add(ws)
			// Replay cached booted message so reconnecting clients get screen dimensions
			const deviceId = ws.data.deviceId
			if (deviceId && sim.lastBooted.has(deviceId)) {
				try {
					// biome-ignore lint/style/noNonNullAssertion: existence checked by .has() above
					ws.send(sim.lastBooted.get(deviceId)!)
				} catch {}
			}
			if (deviceId && sim.lastFrame.has(deviceId)) {
				try {
					// biome-ignore lint/style/noNonNullAssertion: existence checked by .has() above
					ws.send(sim.lastFrame.get(deviceId)!)
				} catch {}
			}
			// Auto-boot the device so streaming starts immediately on connection.
			// Don't add to bootedDevices until we receive 'booted' confirmation
			// so that failed boots can be retried on reconnect.
			if (deviceId && !sim.bootedDevices.has(deviceId) && sim.upstreamWs) {
				try {
					sim.upstreamWs.send(JSON.stringify({ type: 'boot', deviceId }))
					log('simulator-relay', `sent boot for device ${deviceId}`)
				} catch {}
			}
			log('simulator-relay', `client connected (refCount=${sim.refCount})`)
		})
		.catch(err => {
			log('simulator-relay', `error: ${err}`)
			ws.close(1011, 'Failed to start simulator server')
		})
}

export function handleSimulatorMessage(
	ws: ServerWebSocket<SimulatorWsData>,
	data: string | Buffer,
) {
	// Wait for upstream to be ready, then forward
	ensureReady()
		.then(() => {
			if (!sim?.upstreamWs) return
			let forwarded = data
			// Inject deviceId into client messages so the simulator server routes to the correct device
			if (typeof data === 'string' && ws.data.deviceId) {
				try {
					const msg = JSON.parse(data)
					if (!msg.deviceId) {
						msg.deviceId = ws.data.deviceId
						forwarded = JSON.stringify(msg)
					}
					if (msg.type === 'shutdown' && msg.deviceId) {
						sim.bootedDevices.delete(msg.deviceId)
					}
				} catch {}
			}
			try {
				sim.upstreamWs.send(forwarded)
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
	const deviceKey = ws.data.deviceId ?? ''
	const deviceSet = sim.clientsByDevice.get(deviceKey)
	if (deviceSet) {
		deviceSet.delete(ws)
		if (deviceSet.size === 0) sim.clientsByDevice.delete(deviceKey)
	}
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
