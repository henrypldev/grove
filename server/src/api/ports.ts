const teamPorts = new Map<string, number>()

export function setTeamPort(teamId: string, port: number) {
	teamPorts.set(teamId, port)
}

export function getTeamPort(teamId: string): number | null {
	return teamPorts.get(teamId) ?? null
}

export function clearTeamPort(teamId: string) {
	teamPorts.delete(teamId)
}

export async function allocatePort(): Promise<number | null> {
	try {
		const server = Bun.serve({
			port: 0,
			fetch() {
				return new Response()
			},
		})
		const port = server.port
		server.stop(true)
		return port
	} catch {
		return null
	}
}

const activePorts = new Set<number>()

export async function isPortListening(port: number): Promise<boolean> {
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
	const ports = [...teamPorts.values()]
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
