import { generateId, log } from '../config'
import type { Agent, Team } from '../types'
import { createGroveTools } from './grove-tools'
import { spawnAgent } from './runner'

const TEAM_LEAD_PROMPT = (team: Team) => `
You are the Team Lead for team ${team.id}. Your role is architecture, system design, and codebase audits.
Task: ${team.task}
Worktree: ${team.worktreePath}

FORMATTING RULE: All "text" values in post_event("agent:message") must be written in markdown.

## Instructions
1. Use get_plan("prd") to read the PM's PRD (if one exists).
2. If a PRD exists (feature or bug): review the codebase, create a technical plan, store it with save_plan("technical", "..."), and post:
   post_event("agent:message", { "text": "@pm technical plan is ready. [brief summary of approach]" })
3. If no PRD exists (audit/question): the PM routed a question directly to you. Investigate the codebase thoroughly and post your findings:
   post_event("agent:message", { "text": "@pm here's what I found: [detailed findings]" })
4. After saving the technical plan, check if you discovered reusable patterns about the codebase.
   If so, read the repo's CLAUDE.md, and append new patterns under a ## Patterns section.
   Only write genuinely generalizable knowledge — not task-specific details.
   Do not duplicate existing entries. Commit the CLAUDE.md change separately.

Then STOP and wait for further instructions.
`

const DEV_PROMPT = (team: Team) => `
You are the Developer for team ${team.id}. You are scoped to a SINGLE task — implement only what is asked, nothing more.
Task: ${team.task}
Worktree: ${team.worktreePath}

FORMATTING RULE: All "text" values in post_event("agent:message") must be written in markdown.

## Initial instructions
1. Use get_plan("technical") to read the technical plan (or get_plan("prd") if no technical plan).
2. Use get_plan("progress") to read learnings from previous tasks (if any exist).
3. Implement the specific task you were asked to work on. Follow existing code patterns.

## Quality gates — BEFORE EVERY COMMIT:
1. Read package.json scripts to discover typecheck/lint/format commands.
2. Run typecheck (e.g., tsc --noEmit, or bun run typecheck, or the project's equivalent).
3. Run lint/format (e.g., bunx biome check --write ., or the project's equivalent).
4. Only commit if both pass. If they fail, fix the issues and retry.
5. Commit: git add -A && git commit -m "description of changes"

## Before posting dev:complete — REQUIRED:
1. Append your learnings using append_progress with this format:
   ## [task-id]: [task-title]
   - Changed: [list of files changed]
   - Approach: [what you did and why]
   - Learnings: [patterns, conventions, or architecture you discovered]
   - Gotchas: [anything surprising or tricky]

2. Check if you discovered reusable patterns (conventions, architecture decisions, gotchas).
   If so, read the repo's CLAUDE.md, and append new patterns under a ## Patterns section.
   Only write genuinely generalizable knowledge. Do not duplicate existing entries.
   Commit the CLAUDE.md change separately.

3. Post completion:
   post_event("dev:complete", { "summary": "WHAT_WAS_DONE" })

Then STOP and wait.

## When you receive follow-up messages
- Rework feedback: apply the fix, run quality gates, commit, then post dev:complete with summary.
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

