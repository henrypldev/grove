import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { MessageQueue } from './message-queue'
import { cleanupAgentSession } from './runner'

export interface RegisteredAgent {
	agentId: string
	queue: MessageQueue
	query: Query
}

const registry = new Map<string, Map<string, RegisteredAgent>>()

/**
 * Task-scoped agents: Map<teamId, Map<taskId, RegisteredAgent>>
 * Used for parallel dev agents, each working on a separate task.
 */
const taskRegistry = new Map<string, Map<string, RegisteredAgent>>()

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

export function registerTaskAgent(
	teamId: string,
	taskId: string,
	entry: RegisteredAgent,
) {
	let team = taskRegistry.get(teamId)
	if (!team) {
		team = new Map()
		taskRegistry.set(teamId, team)
	}
	team.set(taskId, entry)
}

export function getAgent(
	teamId: string,
	role: string,
): RegisteredAgent | undefined {
	return registry.get(teamId)?.get(role)
}

export function getTaskAgent(
	teamId: string,
	taskId: string,
): RegisteredAgent | undefined {
	return taskRegistry.get(teamId)?.get(taskId)
}

export function getAllTaskAgents(teamId: string): Map<string, RegisteredAgent> {
	return taskRegistry.get(teamId) ?? new Map()
}

export function getAllAgents(teamId: string): RegisteredAgent[] {
	const team = registry.get(teamId)
	const roleAgents = team ? [...team.values()] : []
	const taskAgents = taskRegistry.get(teamId)
	const taskAgentsList = taskAgents ? [...taskAgents.values()] : []
	return [...roleAgents, ...taskAgentsList]
}

export function closeAgent(teamId: string, role: string, agentId?: string) {
	const team = registry.get(teamId)
	if (!team) return
	const entry = team.get(role)
	if (entry) {
		// If agentId is provided, only close if it matches the current agent
		// This prevents a stale callback from closing a newly-spawned replacement
		if (agentId && entry.agentId !== agentId) return
		entry.queue.close()
		entry.query.close()
		cleanupAgentSession(entry.agentId)
		team.delete(role)
	}
	if (team.size === 0) registry.delete(teamId)
}

export function closeTaskAgent(teamId: string, taskId: string) {
	const team = taskRegistry.get(teamId)
	if (!team) return
	const entry = team.get(taskId)
	if (entry) {
		entry.queue.close()
		entry.query.close()
		cleanupAgentSession(entry.agentId)
		team.delete(taskId)
	}
	if (team.size === 0) taskRegistry.delete(teamId)
}

export function closeAllAgents(teamId: string) {
	const team = registry.get(teamId)
	if (team) {
		for (const entry of team.values()) {
			entry.queue.close()
			entry.query.close()
			cleanupAgentSession(entry.agentId)
		}
		registry.delete(teamId)
	}
	const taskTeam = taskRegistry.get(teamId)
	if (taskTeam) {
		for (const entry of taskTeam.values()) {
			entry.queue.close()
			entry.query.close()
			cleanupAgentSession(entry.agentId)
		}
		taskRegistry.delete(teamId)
	}
}
