import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { MessageQueue } from './message-queue'

export interface RegisteredAgent {
	agentId: string
	queue: MessageQueue
	query: Query
}

const registry = new Map<string, Map<string, RegisteredAgent>>()

export function registerAgent(
	teamId: string,
	role: string,
	entry: RegisteredAgent,
) {
	let team = registry.get(teamId)
	if (!team) {
		team = new Map()
		registry.set(teamId, team)
	}
	team.set(role, entry)
}

export function getAgent(
	teamId: string,
	role: string,
): RegisteredAgent | undefined {
	return registry.get(teamId)?.get(role)
}

export function getAllAgents(teamId: string): RegisteredAgent[] {
	const team = registry.get(teamId)
	return team ? [...team.values()] : []
}

export function closeAgent(teamId: string, role: string) {
	const team = registry.get(teamId)
	if (!team) return
	const entry = team.get(role)
	if (entry) {
		entry.queue.close()
		entry.query.close()
		team.delete(role)
	}
	if (team.size === 0) registry.delete(teamId)
}

export function closeAllAgents(teamId: string) {
	const team = registry.get(teamId)
	if (!team) return
	for (const entry of team.values()) {
		entry.queue.close()
		entry.query.close()
	}
	registry.delete(teamId)
}
