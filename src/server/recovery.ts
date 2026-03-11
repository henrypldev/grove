import { existsSync } from 'node:fs'
import { recoverAgents } from './agents/recovery'
import { log } from './config'
import { dbListTasks } from './db/agent-tasks'
import { dbListAgentsByTeam } from './db/agents'
import { dbListTeams, dbUpdateTeamStatus } from './db/teams'
import { initHandlersForTeam } from './handlers'
import {
	restoreDevBaseCommit,
	restoreTaskWorktree,
} from './handlers/dev-complete'

const RECOVERABLE_TEAM_STATUSES = new Set(['working', 'active', 'blocked'])

export async function recoverActiveTeams(): Promise<void> {
	const teams = dbListTeams()
	const recoverableTeams = teams.filter(t =>
		RECOVERABLE_TEAM_STATUSES.has(t.status),
	)

	if (recoverableTeams.length === 0) {
		log('recovery', 'no teams to recover')
		return
	}

	log('recovery', `recovering ${recoverableTeams.length} teams`)

	for (const team of recoverableTeams) {
		try {
			// Verify worktree exists on disk
			if (!existsSync(team.worktreePath)) {
				log('recovery', 'worktree gone, marking team error', {
					teamId: team.id,
					path: team.worktreePath,
				})
				dbUpdateTeamStatus(team.id, 'blocked')
				continue
			}

			// Re-establish handler subscriptions
			await initHandlersForTeam(team.id)

			// Restore in-memory maps from DB
			const agents = dbListAgentsByTeam(team.id)
			for (const agent of agents) {
				if (agent.baseCommitSha) {
					const key = agent.taskId ? `${team.id}:${agent.taskId}` : team.id
					restoreDevBaseCommit(key, agent.baseCommitSha)
				}
			}

			const tasks = dbListTasks(team.id)
			for (const task of tasks) {
				if (task.worktreePath) {
					const key = `${team.id}:${task.idString}`
					restoreTaskWorktree(key, task.worktreePath)
				}
			}

			// Recover agents
			await recoverAgents(team)

			log('recovery', 'team recovered', { teamId: team.id })
		} catch (err) {
			log('recovery', 'team recovery failed', { teamId: team.id, err })
			dbUpdateTeamStatus(team.id, 'blocked')
		}
	}
}
