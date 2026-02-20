import { generateId, log } from '../config'
import type { Agent, Team } from '../types'
import { spawnPm } from './pm'

let orchestratorAgent: Agent | null = null

export async function startOrchestrator() {
	if (orchestratorAgent) return orchestratorAgent

	log('orchestrator', 'starting')
	orchestratorAgent = {
		id: generateId(),
		teamId: 'orchestrator',
		role: 'orchestrator',
		status: 'working',
		currentTask: 'orchestrating',
		sessionId: null,
		retryCount: 0,
		spawnedAt: Date.now(),
		updatedAt: Date.now(),
	}
	log('orchestrator', 'started', { id: orchestratorAgent.id })
	return orchestratorAgent
}

export async function onNewTeam(team: Team) {
	log('orchestrator', 'new team received', { teamId: team.id, task: team.task })
	await spawnPm(team)
}
