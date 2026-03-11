import { checkFingerprintAndRebuild } from '../api/expo-build'
import { log } from '../config'
import { dbListAgentsByTeam, dbUpdateAgentStatus } from '../db/agents'
import { dbGetRepo } from '../db/repos'
import { getTaskWorktreePath } from '../handlers/dev-complete'
import type { Agent, Team } from '../types'
import { closeAgent } from './agent-registry'
import { respawnPm } from './pm'
import {
	spawnDeveloper,
	spawnReviewerAgent,
	spawnTaskDeveloper,
	spawnTeamLead,
} from './specialists'

const RECOVERABLE_STATUSES = new Set([
	'working',
	'idle',
	'suspended',
	'waiting',
])

export async function recoverAgents(team: Team): Promise<void> {
	const agents = dbListAgentsByTeam(team.id)
	const recoverable = agents.filter(a => RECOVERABLE_STATUSES.has(a.status))

	if (recoverable.length === 0) {
		log('recovery', 'no agents to recover', { teamId: team.id })
		return
	}

	log('recovery', `recovering ${recoverable.length} agents`, {
		teamId: team.id,
		roles: recoverable.map(a => a.role),
	})

	for (const agent of recoverable) {
		try {
			await recoverAgent(team, agent)
		} catch (err) {
			log('recovery', `agent recovery failed for ${agent.role}`, {
				teamId: team.id,
				agentId: agent.id,
				err,
			})
			dbUpdateAgentStatus(agent.id, agent.teamId, 'error')
		}
	}
}

async function recoverAgent(team: Team, agent: Agent): Promise<void> {
	log('recovery', `recovering ${agent.role} agent`, {
		teamId: team.id,
		agentId: agent.id,
		previousStatus: agent.status,
	})

	switch (agent.role) {
		case 'pm':
			await recoverPm(team, agent)
			break
		case 'dev':
			await recoverDev(team, agent)
			break
		case 'team-lead':
			await recoverTeamLead(team, agent)
			break
		case 'reviewer':
			await recoverReviewer(team, agent)
			break
		default:
			log('recovery', `unknown role ${agent.role}, marking error`, {
				agentId: agent.id,
			})
			dbUpdateAgentStatus(agent.id, agent.teamId, 'error')
	}
}

async function recoverPm(team: Team, agent: Agent): Promise<void> {
	const pmRef = { agentId: '' }
	const { agent: newPm } = await respawnPm(
		team,
		'You are resuming after a server restart. Check get_events(0) for full history and continue where you left off.',
		{
			onDone: () => {
				closeAgent(team.id, 'pm', pmRef.agentId)
			},
			onError: () => {
				closeAgent(team.id, 'pm', pmRef.agentId)
			},
		},
	)
	pmRef.agentId = newPm.id
	// Mark old agent as done since we respawned
	dbUpdateAgentStatus(agent.id, agent.teamId, 'done')
	log('recovery', 'pm recovered via respawn', {
		teamId: team.id,
		oldAgentId: agent.id,
		newAgentId: newPm.id,
	})
}

function makeOnPostBash(team: Team): ((command: string) => void) | undefined {
	const repo = dbGetRepo(team.repoId)
	if (!repo?.needsNativeBuild) return undefined

	const installPattern =
		/\b(npm install|yarn add|pnpm add|bun add|bun install|expo install)\b/
	return (command: string) => {
		if (installPattern.test(command)) {
			checkFingerprintAndRebuild(team.id, team.worktreePath, team.repoId)
		}
	}
}

async function recoverDev(team: Team, agent: Agent): Promise<void> {
	if (agent.taskId) {
		// Task-scoped dev — needs its worktree path
		const wtKey = `${team.id}:${agent.taskId}`
		const worktreePath = getTaskWorktreePath(wtKey)
		if (!worktreePath) {
			log('recovery', 'task dev worktree path not found, marking error', {
				teamId: team.id,
				agentId: agent.id,
				taskId: agent.taskId,
			})
			dbUpdateAgentStatus(agent.id, agent.teamId, 'error')
			return
		}
		await spawnTaskDeveloper(team, agent.taskId, worktreePath, {
			onPostBash: makeOnPostBash(team),
		})
	} else {
		await spawnDeveloper(team, { onPostBash: makeOnPostBash(team) })
	}
	dbUpdateAgentStatus(agent.id, agent.teamId, 'done')
	log('recovery', 'dev recovered via respawn', {
		teamId: team.id,
		oldAgentId: agent.id,
	})
}

async function recoverTeamLead(team: Team, agent: Agent): Promise<void> {
	await spawnTeamLead(team)
	dbUpdateAgentStatus(agent.id, agent.teamId, 'done')
	log('recovery', 'team-lead recovered via respawn', {
		teamId: team.id,
		oldAgentId: agent.id,
	})
}

async function recoverReviewer(team: Team, agent: Agent): Promise<void> {
	await spawnReviewerAgent(team)
	dbUpdateAgentStatus(agent.id, agent.teamId, 'done')
	log('recovery', 'reviewer recovered via respawn', {
		teamId: team.id,
		oldAgentId: agent.id,
	})
}
