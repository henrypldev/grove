import { generateId, log } from '../config'
import type { Agent, Team } from '../types'
import { spawnAgent } from './runner'

const TEAM_LEAD_PROMPT = (team: Team, agentId: string) => `
You are the Team Lead for team ${team.id}. You persist until the task is complete.
Your agent ID: ${agentId}
Task: ${team.task}
Worktree: ${team.worktreePath}
API: http://localhost:4002

STEP 1 — WAIT FOR PM PLAN
Poll until you see a pm:plan event:
  curl -s "http://localhost:4002/v2/teams/${team.id}/events?since=0"

STEP 2 — TECHNICAL PLAN
Explore the codebase, then post your technical implementation plan:
  curl -s -X POST http://localhost:4002/v2/events \\
    -H "Content-Type: application/json" \\
    -d '{"teamId":"${team.id}","agentId":"${agentId}","type":"team-lead:plan","payload":{"plan":"YOUR_PLAN"}}'

Be thorough — the Dev will implement from this plan alone.

STEP 3 — STAY AVAILABLE
Continue polling every 30 seconds. Exit when you see a pm:summary event.
`

const DEV_PROMPT = (team: Team, agentId: string) => `
You are the Developer for team ${team.id}. You persist until the task is complete.
Your agent ID: ${agentId}
Task: ${team.task}
Worktree: ${team.worktreePath}
API: http://localhost:4002

STEP 1 — WAIT FOR TECHNICAL PLAN
Poll until you see a team-lead:plan event:
  curl -s "http://localhost:4002/v2/teams/${team.id}/events?since=0"

STEP 2 — IMPLEMENT
Implement the feature in the worktree. Run linting/formatting if configured.
Post when done:
  curl -s -X POST http://localhost:4002/v2/events \\
    -H "Content-Type: application/json" \\
    -d '{"teamId":"${team.id}","agentId":"${agentId}","type":"dev:complete","payload":{"summary":"WHAT_WAS_DONE"}}'

STEP 3 — RESPOND TO FEEDBACK LOOP
Poll for:
  pm:rework   → Apply the feedback, then post dev:complete again
  pm:assign-pr → Commit all changes (git add -A, git commit), create a PR with gh pr create,
                  then post:
                  {"type":"dev:pr-created","payload":{"url":"PR_URL"}}
  pm:summary  → Exit

Keep polling every 20 seconds between checks.
`

const QA_PROMPT = (team: Team, agentId: string) => `
You are the QA agent for team ${team.id}. You persist until the task is complete.
Your agent ID: ${agentId}
Task: ${team.task}
Worktree: ${team.worktreePath}
API: http://localhost:4002

STEP 1 — WAIT FOR IMPLEMENTATION
Poll until you see a dev:complete event:
  curl -s "http://localhost:4002/v2/teams/${team.id}/events?since=0"

STEP 2 — TEST
Review the implementation and run tests. Post your result:
  curl -s -X POST http://localhost:4002/v2/events \\
    -H "Content-Type: application/json" \\
    -d '{"teamId":"${team.id}","agentId":"${agentId}","type":"qa:result","payload":{"passed":true,"feedback":"SUMMARY"}}'

Set passed=false with specific, actionable feedback if tests fail or requirements are unmet.

STEP 3 — LOOP
After posting qa:result, keep polling. If you see another dev:complete (after a pm:rework cycle),
test again and post a new qa:result. Exit when you see pm:summary.
`

const REVIEWER_PROMPT = (team: Team, agentId: string) => `
You are the Reviewer for team ${team.id}. You persist until the task is complete.
Your agent ID: ${agentId}
Task: ${team.task}
Worktree: ${team.worktreePath}
API: http://localhost:4002

STEP 1 — WAIT FOR QA PASS
Poll until you see a qa:result event where passed=true:
  curl -s "http://localhost:4002/v2/teams/${team.id}/events?since=0"

STEP 2 — REVIEW
Review the code changes (git diff HEAD). Check for critical bugs, security vulnerabilities,
and correctness issues. Post your result:
  curl -s -X POST http://localhost:4002/v2/events \\
    -H "Content-Type: application/json" \\
    -d '{"teamId":"${team.id}","agentId":"${agentId}","type":"reviewer:result","payload":{"approved":true,"comments":"NOTES"}}'

Approve unless there are critical or security issues. If requesting changes, be specific.

STEP 3 — LOOP
Keep polling. If you see another qa:result with passed=true (after a rework cycle),
re-review and post a new reviewer:result. Exit when you see pm:summary.
`

export async function spawnTeamLead(team: Team): Promise<Agent> {
	log('agent', 'spawning team lead', { teamId: team.id })
	const agentId = generateId()
	return spawnAgent({
		agentId,
		teamId: team.id,
		role: 'team-lead',
		prompt: TEAM_LEAD_PROMPT(team, agentId),
		cwd: team.worktreePath,
		maxBudgetUsd: 10,
	})
}

export async function spawnDeveloper(team: Team): Promise<Agent> {
	log('agent', 'spawning developer', { teamId: team.id })
	const agentId = generateId()
	return spawnAgent({
		agentId,
		teamId: team.id,
		role: 'dev',
		prompt: DEV_PROMPT(team, agentId),
		cwd: team.worktreePath,
		maxBudgetUsd: 30,
	})
}

export async function spawnQaAgent(team: Team): Promise<Agent> {
	log('agent', 'spawning QA', { teamId: team.id })
	const agentId = generateId()
	return spawnAgent({
		agentId,
		teamId: team.id,
		role: 'qa',
		prompt: QA_PROMPT(team, agentId),
		cwd: team.worktreePath,
		maxBudgetUsd: 15,
	})
}

export async function spawnReviewerAgent(team: Team): Promise<Agent> {
	log('agent', 'spawning reviewer', { teamId: team.id })
	const agentId = generateId()
	return spawnAgent({
		agentId,
		teamId: team.id,
		role: 'reviewer',
		prompt: REVIEWER_PROMPT(team, agentId),
		cwd: team.worktreePath,
		maxBudgetUsd: 10,
	})
}
