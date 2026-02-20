import { log } from '../config'
import { dbUpdateTeamStatus } from '../db/teams'
import type { Agent, Team } from '../types'
import { spawnAgent } from './runner'

const PM_SYSTEM_PROMPT = (team: Team) => `
You are the PM agent for team ${team.id}.
Task: ${team.task}
Working directory: ${team.worktreePath}

Your responsibilities:
1. Create a technical plan and assign it to the Team Lead
2. Coordinate the task lifecycle: Dev → QA → Review → PR
3. Monitor agent health and respawn on failure (max 3 retries)
4. Report status updates via agent:message events
5. Signal task completion when PR is created

Write events to the server via: POST http://localhost:4002/v2/events
Your team ID: ${team.id}

TeamState transitions:
- planning → active (when Team Lead has a plan)
- active → review (when QA passes)
- review → done (when PR created)
- any → blocked (if retries exhausted)

Communicate ONLY through structured events. Use curl to write events.
`

export async function spawnPm(team: Team): Promise<Agent> {
	log('pm', 'spawning PM agent', { teamId: team.id })

	const pmAgent = await spawnAgent({
		teamId: team.id,
		role: 'pm',
		prompt: PM_SYSTEM_PROMPT(team),
		cwd: team.worktreePath,
		maxBudgetUsd: 20,
		onDone: agentId => {
			log('pm', 'PM agent completed', { agentId, teamId: team.id })
			dbUpdateTeamStatus(team.id, 'done')
		},
		onError: (agentId, err) => {
			log('pm', 'PM agent error', { agentId, teamId: team.id, err })
			dbUpdateTeamStatus(team.id, 'blocked')
		},
	})

	dbUpdateTeamStatus(team.id, 'active')
	return pmAgent
}
