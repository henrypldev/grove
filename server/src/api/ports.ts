import { dbListTeams } from '../db/teams'

const PORT_MIN = 8082
const PORT_MAX = 8099

export function allocatePort(): number | null {
	const teams = dbListTeams()
	const usedPorts = new Set(
		teams.map(t => t.port).filter((p): p is number => p !== null),
	)
	for (let port = PORT_MIN; port <= PORT_MAX; port++) {
		if (!usedPorts.has(port)) return port
	}
	return null
}

const activePorts = new Set<number>()

async function isPortListening(port: number): Promise<boolean> {
	try {
		const socket = await Bun.connect({
			hostname: '127.0.0.1',
			port,
			socket: {
				data() {},
				open(socket) {
					socket.end()
				},
				error() {},
			},
		})
		socket.end()
		return true
	} catch {
		return false
	}
}

async function pollPorts() {
	const teams = dbListTeams()
	const ports = teams.map(t => t.port).filter((p): p is number => p !== null)
	const results = await Promise.all(
		ports.map(async port => ({ port, alive: await isPortListening(port) })),
	)
	activePorts.clear()
	for (const { port, alive } of results) {
		if (alive) activePorts.add(port)
	}
}

let pollInterval: ReturnType<typeof setInterval> | null = null

export function startPortPoller() {
	pollPorts()
	pollInterval = setInterval(pollPorts, 5000)
}

export function stopPortPoller() {
	if (pollInterval) clearInterval(pollInterval)
	pollInterval = null
}

export function isPortActive(port: number): boolean {
	return activePorts.has(port)
}
