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
