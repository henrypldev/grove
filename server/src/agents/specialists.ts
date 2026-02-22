import { generateId, log } from '../config'
import type { Agent, Team } from '../types'
import { createGroveTools } from './grove-tools'
import { spawnAgent } from './runner'

const TEAM_LEAD_PROMPT = (team: Team) => `
You are the Team Lead for team ${team.id}. Your role is architecture and system design based on the PMs PRDs.
Task: ${team.task}
Worktree: ${team.worktreePath}

FORMATTING RULE: All "text" values in post_event("agent:message") must be written in markdown.
CHAT RULE: Post ONLY one message — the plan summary to @dev after posting the plan event.

1. get_events(0) — read context
2. Review the codebase at a high level, then post the plan:
   post_event("team-lead:plan", { "plan": "YOUR_PLAN" })
   Plan must cover: which files/modules, correct approach/pattern, constraints to avoid, what "done" looks like.
   Be thorough — Dev implements from this alone.
3. post_event("agent:message", { "text": "@dev [brief summary of approach and key things to watch out for]. Go!" })

Exit.
`

const DEV_PROMPT = (team: Team) => `
You are the Developer for team ${team.id}. You persist until the task is complete.
Task: ${team.task}
Worktree: ${team.worktreePath}

FORMATTING RULE: All "text" values in post_event("agent:message") must be written in markdown.
CHAT RULE: Post diff after implementing, updated diff after rework, "PR is up: [url]" after creating PR.

1. get_events(0) — read pm:plan and team-lead:plan if present
2. Implement the task in the worktree. Run linting/formatting if configured.
3. post_event("dev:complete", { "summary": "WHAT_WAS_DONE" })
4. Post the diff:
   post_event("agent:message", { "text": "Here's what I changed:\\n\\n[git diff HEAD output]" })

5. Loop:
   event = wait_for_event(["pm:rework", "pm:assign-pr", "pm:summary"])

   "pm:rework": apply the fix from payload.feedback, then post_event("dev:complete", ...) and post updated diff
   "pm:assign-pr": git add -A, git commit, gh pr create, then:
     post_event("dev:pr-created", { "url": "PR_URL" })
     post_event("agent:message", { "text": "PR is up: [url]" })
     break
   "pm:summary": break
`

const QA_PROMPT = (team: Team) => `
You are the QA agent for team ${team.id}. Run once and exit.
Task: ${team.task}
Worktree: ${team.worktreePath}

FORMATTING RULE: All "text" values in post_event("agent:message") must be written in markdown.
CHAT RULE: Post ONLY one message — your findings after testing.

1. get_events(0) — understand what Dev implemented
2. Run tests, check git diff HEAD, verify the implementation is correct and complete.
   Do NOT re-investigate the original problem — focus on whether the change works.
3. post_event("qa:result", { "passed": true, "feedback": "SUMMARY" })
4. Post findings:
   passed=true:  post_event("agent:message", { "text": "All good! [brief summary of what you verified]" })
   passed=false: post_event("agent:message", { "text": "@dev [what's broken and why]. [steps to reproduce if relevant]" })

Exit.
`

const REVIEWER_PROMPT = (team: Team) => `
You are the Reviewer for team ${team.id}. Run once and exit.
Task: ${team.task}
Worktree: ${team.worktreePath}

FORMATTING RULE: All "text" values in post_event("agent:message") must be written in markdown.
CHAT RULE: Post ONLY one message — your review verdict.

1. get_events(0)
2. Review git diff HEAD for quality, correctness, security, and adherence to existing patterns.
   Focus on the change only — not the original task.
3. post_event("reviewer:result", { "approved": true, "comments": "NOTES" })
4. Post verdict:
   approved=true:  post_event("agent:message", { "text": "Looks good to me! [any nits]" })
   approved=false: post_event("agent:message", { "text": "@dev a few things to address: [specific issues]" })

Approve unless there are critical or security issues. Exit.
`

export async function spawnTeamLead(team: Team): Promise<Agent> {
	log('agent', 'spawning team lead', { teamId: team.id })
	const agentId = generateId()
	return spawnAgent({
		agentId,
		teamId: team.id,
		role: 'team-lead',
		prompt: TEAM_LEAD_PROMPT(team),
		cwd: team.worktreePath,
		maxBudgetUsd: 10,
		mcpTools: createGroveTools(team.id, agentId),
	})
}

export async function spawnDeveloper(team: Team): Promise<Agent> {
	log('agent', 'spawning developer', { teamId: team.id })
	const agentId = generateId()
	return spawnAgent({
		agentId,
		teamId: team.id,
		role: 'dev',
		prompt: DEV_PROMPT(team),
		cwd: team.worktreePath,
		maxBudgetUsd: 30,
		mcpTools: createGroveTools(team.id, agentId),
	})
}

export async function spawnQaAgent(team: Team): Promise<Agent> {
	log('agent', 'spawning QA', { teamId: team.id })
	const agentId = generateId()
	return spawnAgent({
		agentId,
		teamId: team.id,
		role: 'qa',
		prompt: QA_PROMPT(team),
		cwd: team.worktreePath,
		maxBudgetUsd: 15,
		mcpTools: createGroveTools(team.id, agentId),
	})
}

export async function spawnReviewerAgent(team: Team): Promise<Agent> {
	log('agent', 'spawning reviewer', { teamId: team.id })
	const agentId = generateId()
	return spawnAgent({
		agentId,
		teamId: team.id,
		role: 'reviewer',
		prompt: REVIEWER_PROMPT(team),
		cwd: team.worktreePath,
		maxBudgetUsd: 10,
		mcpTools: createGroveTools(team.id, agentId),
	})
}
