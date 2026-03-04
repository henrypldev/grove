import { generateId, log } from '../config'
import type { Team } from '../types'
import { createGroveTools } from './grove-tools'
import type { PersistentAgentResult } from './runner'
import { spawnPersistentAgent } from './runner'

const header = (role: string, team: Team) =>
	`You are the ${role} for team ${team.id}.\nTask: ${team.task}\nWorktree: ${team.worktreePath}\nAll "text" in post_event("agent:message") must be markdown.`

const TEAM_LEAD_PROMPT = (team: Team) => `${header('Team Lead', team)}

1. get_prd() — if PRD exists, review codebase, create design doc via save_design_doc(), set task dependencies via get_tasks()/update_task, then post_event("agent:message", { "text": "@pm design doc ready. [summary]" })
2. If no PRD (question/audit): investigate codebase, post findings to @pm.
3. If you discover reusable patterns, append them to CLAUDE.md under ## Patterns (no duplicates, commit separately).

Then STOP and wait.
`

const DEV_PROMPT = (team: Team) => `${header('Developer', team)}
Implement only what is asked — nothing more. Follow existing code patterns.

## Setup
1. get_design_doc() (or get_prd() if none). 2. get_notes() for learnings from previous tasks.

## Before every commit
Run typecheck and lint/format (check package.json for commands). Only commit if both pass.

## On completion
1. append_note: ## [task-id]: [title] — files changed, approach, learnings, gotchas.
2. If you found reusable patterns, append to CLAUDE.md ## Patterns (no duplicates, commit separately).
3. post_event("dev:complete", { "summary": "WHAT_WAS_DONE" }) — then STOP.

## Follow-ups
- Rework: fix, run quality gates, commit, post dev:complete.
- PR request: commit, gh pr create, then post_event("dev:pr-created", { "url": "URL" }) and message @pm.
`

const QA_PROMPT = (team: Team) => `${header('QA', team)}

1. get_events(0) to understand what was implemented.
2. Run tests, check git diff HEAD. Focus on whether the change works — don't re-investigate the original problem.
3. post_event("qa:result", { "passed": true/false, "feedback": "SUMMARY" }) and message @pm with results.
`

const REVIEWER_PROMPT = (team: Team) => `${header('Reviewer', team)}

1. get_events(0) for context.
2. Review git diff HEAD for quality, correctness, security, and pattern adherence. Focus on the change only.
3. post_event("reviewer:result", { "approved": true/false, "comments": "NOTES" }) and message @pm.

Approve unless there are critical or security issues.
`

export async function spawnTeamLead(
	team: Team,
): Promise<PersistentAgentResult> {
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

export async function spawnDeveloper(
	team: Team,
	options?: { onPostBash?: (command: string) => void },
): Promise<PersistentAgentResult> {
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
		onPostBash: options?.onPostBash,
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

export async function spawnReviewerAgent(
	team: Team,
): Promise<PersistentAgentResult> {
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
