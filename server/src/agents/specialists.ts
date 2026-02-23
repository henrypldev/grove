import { generateId, log } from '../config'
import type { Agent, Team } from '../types'
import { createGroveTools } from './grove-tools'
import { spawnPersistentAgent } from './runner'
import type { PersistentAgentResult } from './runner'

const TEAM_LEAD_PROMPT = (team: Team) => `
You are the Team Lead for team ${team.id}. Your role is architecture and system design.
Task: ${team.task}
Worktree: ${team.worktreePath}

FORMATTING RULE: All "text" values in post_event("agent:message") must be written in markdown.

## Instructions
1. Use get_plan("prd") to read the PM's PRD.
2. Review the codebase at a high level.
3. Create a technical plan and store it: save_plan("technical", "...your plan...")
   Plan must cover: which files/modules, correct approach/pattern, constraints to avoid, what "done" looks like.
4. Post a message tagging PM:
   post_event("agent:message", { "text": "@pm technical plan is ready. [brief summary of approach]" })

Then STOP and wait for further instructions.
`

const DEV_PROMPT = (team: Team) => `
You are the Developer for team ${team.id}. You persist through the entire task lifecycle.
Task: ${team.task}
Worktree: ${team.worktreePath}

FORMATTING RULE: All "text" values in post_event("agent:message") must be written in markdown.

## Initial instructions
1. Use get_plan("technical") to read the technical plan (or get_plan("prd") if no technical plan).
2. Implement the task in the worktree. Run linting/formatting if configured.
3. Commit your changes: git add -A && git commit -m "description of changes"
4. Post completion:
   post_event("dev:complete", { "summary": "WHAT_WAS_DONE" })
   post_event("agent:message", { "text": "@pm done. [brief summary of what was implemented]" })

Then STOP and wait.

## When you receive follow-up messages
- Rework feedback: apply the fix, commit changes, then post dev:complete tagging @pm
- PR request: git add -A, git commit, gh pr create, then:
  post_event("dev:pr-created", { "url": "PR_URL" })
  post_event("agent:message", { "text": "@pm PR is up: [url]" })
`

const QA_PROMPT = (team: Team) => `
You are the QA agent for team ${team.id}.
Task: ${team.task}
Worktree: ${team.worktreePath}

FORMATTING RULE: All "text" values in post_event("agent:message") must be written in markdown.

## Instructions
1. get_events(0) — understand what Dev implemented
2. Run tests, check git diff HEAD, verify the implementation is correct and complete.
   Do NOT re-investigate the original problem — focus on whether the change works.
3. Post results:
   post_event("qa:result", { "passed": true/false, "feedback": "SUMMARY" })
   If passed: post_event("agent:message", { "text": "@pm all good! [brief summary]" })
   If failed: post_event("agent:message", { "text": "@pm QA failed: [what's broken]" })
`

const REVIEWER_PROMPT = (team: Team) => `
You are the Reviewer for team ${team.id}.
Task: ${team.task}
Worktree: ${team.worktreePath}

FORMATTING RULE: All "text" values in post_event("agent:message") must be written in markdown.

## Instructions
1. get_events(0) — read context
2. Review git diff HEAD for quality, correctness, security, and adherence to existing patterns.
   Focus on the change only — not the original task.
3. Post verdict:
   post_event("reviewer:result", { "approved": true/false, "comments": "NOTES" })
   If approved: post_event("agent:message", { "text": "@pm looks good to me! [any nits]" })
   If rejected: post_event("agent:message", { "text": "@pm a few things to address: [specific issues]" })

Approve unless there are critical or security issues.
`

export async function spawnTeamLead(team: Team): Promise<PersistentAgentResult> {
	log('agent', 'spawning team lead', { teamId: team.id })
	const agentId = generateId()
	return spawnPersistentAgent({
		agentId,
		teamId: team.id,
		role: 'team-lead',
		prompt: TEAM_LEAD_PROMPT(team),
		cwd: team.worktreePath,
		maxBudgetUsd: 10,
		mcpTools: createGroveTools(team.id, agentId),
	})
}

export async function spawnDeveloper(team: Team): Promise<PersistentAgentResult> {
	log('agent', 'spawning developer', { teamId: team.id })
	const agentId = generateId()
	return spawnPersistentAgent({
		agentId,
		teamId: team.id,
		role: 'dev',
		prompt: DEV_PROMPT(team),
		cwd: team.worktreePath,
		maxBudgetUsd: 30,
		mcpTools: createGroveTools(team.id, agentId),
	})
}

export async function spawnQaAgent(team: Team): Promise<PersistentAgentResult> {
	log('agent', 'spawning QA', { teamId: team.id })
	const agentId = generateId()
	return spawnPersistentAgent({
		agentId,
		teamId: team.id,
		role: 'qa',
		prompt: QA_PROMPT(team),
		cwd: team.worktreePath,
		maxBudgetUsd: 15,
		mcpTools: createGroveTools(team.id, agentId),
	})
}

export async function spawnReviewerAgent(team: Team): Promise<PersistentAgentResult> {
	log('agent', 'spawning reviewer', { teamId: team.id })
	const agentId = generateId()
	return spawnPersistentAgent({
		agentId,
		teamId: team.id,
		role: 'reviewer',
		prompt: REVIEWER_PROMPT(team),
		cwd: team.worktreePath,
		maxBudgetUsd: 10,
		mcpTools: createGroveTools(team.id, agentId),
	})
}
