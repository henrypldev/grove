import { log } from '../config'
import type { Agent, Team } from '../types'
import { spawnAgent } from './runner'

const TEAM_LEAD_PROMPT = (team: Team) => `
You are the Team Lead for team ${team.id}.
Task: ${team.task}
Worktree: ${team.worktreePath}

Your job: produce a detailed technical plan (architecture, subtasks, file list).
Write your plan as an event: POST http://localhost:4002/v2/events
  body: { teamId: "${team.id}", agentId: YOUR_AGENT_ID, type: "team_lead:plan_created", payload: { plan: "..." } }

Then signal completion so the PM can assign to Developer.
`

const DEVELOPER_PROMPT = (team: Team, plan: string) => `
You are the Developer agent for team ${team.id}.
Task: ${team.task}
Worktree: ${team.worktreePath}
Technical plan: ${plan}

Your job:
1. Implement the feature in the worktree
2. Write events for each file write and command run
3. Signal "implementation complete" when done
4. On QA pass + Reviewer approval: create a PR using gh pr create

Write events via: POST http://localhost:4002/v2/events
`

const QA_PROMPT = (team: Team) => `
You are the QA agent for team ${team.id}.
Worktree: ${team.worktreePath}

Your job:
1. Read the Developer's implementation
2. Write and run tests
3. Report pass/fail via: POST http://localhost:4002/v2/events
   type: "qa:test_result", payload: { passed: bool, summary: "..." }
`

const REVIEWER_PROMPT = (team: Team) => `
You are the Reviewer agent for team ${team.id}.
Worktree: ${team.worktreePath}

Your job:
1. Review the code changes in the worktree
2. Produce structured review comments
3. Approve or request changes via: POST http://localhost:4002/v2/events
   type: "reviewer:review_submitted", payload: { approved: bool, comments: [...] }
`

export async function spawnTeamLead(team: Team): Promise<Agent> {
	log('agent', 'spawning team lead', { teamId: team.id })
	return spawnAgent({
		teamId: team.id,
		role: 'team-lead',
		prompt: TEAM_LEAD_PROMPT(team),
		cwd: team.worktreePath,
		maxBudgetUsd: 3,
	})
}

export async function spawnDeveloper(team: Team, plan: string): Promise<Agent> {
	log('agent', 'spawning developer', { teamId: team.id })
	return spawnAgent({
		teamId: team.id,
		role: 'dev',
		prompt: DEVELOPER_PROMPT(team, plan),
		cwd: team.worktreePath,
		maxBudgetUsd: 10,
	})
}

export async function spawnQa(team: Team): Promise<Agent> {
	log('agent', 'spawning QA', { teamId: team.id })
	return spawnAgent({
		teamId: team.id,
		role: 'qa',
		prompt: QA_PROMPT(team),
		cwd: team.worktreePath,
		maxBudgetUsd: 5,
	})
}

export async function spawnReviewer(team: Team): Promise<Agent> {
	log('agent', 'spawning reviewer', { teamId: team.id })
	return spawnAgent({
		teamId: team.id,
		role: 'reviewer',
		prompt: REVIEWER_PROMPT(team),
		cwd: team.worktreePath,
		maxBudgetUsd: 3,
	})
}
