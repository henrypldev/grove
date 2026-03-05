import type { CanUseTool, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { generateId, log } from '../config'
import type { Agent, Team } from '../types'
import { createGroveTools, waitForUserReply } from './grove-tools'
import type { PersistentAgentResult } from './runner'
import { spawnPersistentAgent } from './runner'

function buildPmCanUseTool(teamId: string, agentId: string): CanUseTool {
	return async (toolName, input) => {
		if (toolName !== 'AskUserQuestion') {
			return { behavior: 'allow', updatedInput: input }
		}
		const questions = input.questions as {
			question: string
			header: string
			options: { label: string; description: string }[]
			multiSelect: boolean
		}[]
		if (!questions?.length) {
			return { behavior: 'allow', updatedInput: input }
		}
		const answers = await waitForUserReply(teamId, agentId, questions)
		if (answers._raw) {
			const rawText = answers._raw
			const mapped: Record<string, string> = {}
			for (const q of questions) {
				mapped[q.question] = rawText
			}
			return {
				behavior: 'allow',
				updatedInput: { ...input, answers: mapped },
			}
		}
		return {
			behavior: 'allow',
			updatedInput: { ...input, answers },
		}
	}
}

const PM_PROMPT = (team: Team) => `
You are a non-technical PM for team ${team.id}. You coordinate via @-mentions — never write technical plans or investigate code.
Task: ${team.task}
Worktree: ${team.worktreePath}
All "text" in post_activity("agent:message") must be markdown.

@-mentions (@team-lead, @dev, @qa, @reviewer) in agent:message auto-route to that agent, spawning if needed.

## Workflow
Classify the task, then:
- FEATURE: Use AskUserQuestion for 2-5 clarifying questions (mandatory). Then save_prd(), create_tasks() (simple numeric IDs, ordered by dependency), message @team-lead to review.
- BUG FIX: save_prd(), route to @dev directly.
- QUESTION/AUDIT: route to @team-lead directly, no PRD.

## Task Loop (after team-lead's plan is ready)
1. get_tasks() → pick highest-priority pending task → update_task(id, {status:"in_progress"})
2. Message @dev with the task. Wait for dev:complete.
3. Mark complete, post task:complete. Repeat until all done.
4. All done → message @qa → wait for qa:result → message @reviewer → wait for approval → message @dev to open PR.

## Message handling
- QA failed → forward to @dev (track retries, max 3).
- QA passed → forward to @reviewer.
- Reviewer feedback → forward to @dev (max 3 retries).
- Reviewer approved → tell @dev to open PR.
- PR created → get_events(0), post pm:summary, celebrate.
- 3 failures → post pm:blocked and pm:summary.
`

const PM_RESUME_PROMPT = (team: Team, userMessage: string) => `
You are a non-technical PM for team ${team.id}, resuming after a previous session.
Task: ${team.task}
Worktree: ${team.worktreePath}
All "text" in post_activity("agent:message") must be markdown.

@-mentions (@team-lead, @dev, @qa, @reviewer) auto-route to that agent, spawning if needed.

Start with get_events(0) to read full history. Do NOT re-create existing PRDs or tasks — check with get_prd()/get_tasks().

## Message handling
- QA failed → forward to @dev (max 3 retries). QA passed → forward to @reviewer.
- Reviewer feedback → forward to @dev (max 3). Reviewer approved → tell @dev to open PR.
- PR created → get_events(0), post pm:summary, celebrate.
- 3 failures → post pm:blocked and pm:summary.

## User message
${userMessage}
`

type Callbacks = {
	onDone: () => void
	onError: () => void
	contentBlocks?: SDKUserMessage['message']['content']
}

export async function spawnPm(
	team: Team,
	callbacks: Callbacks,
): Promise<{ agent: Agent; persistent: PersistentAgentResult }> {
	log('pm', 'spawning PM', { teamId: team.id })
	const agentId = generateId()
	const mcpTools = createGroveTools(team.id, agentId)
	const persistent = await spawnPersistentAgent({
		agentId,
		teamId: team.id,
		role: 'pm',
		prompt: PM_PROMPT(team),
		contentBlocks: callbacks.contentBlocks,
		cwd: team.worktreePath,
		maxBudgetUsd: 10,
		allowedTools: ['mcp__grove__*'],
		canUseTool: buildPmCanUseTool(team.id, agentId),
		mcpTools,
		onDone: callbacks.onDone,
		onError: callbacks.onError,
	})
	return { agent: persistent.agent, persistent }
}

export async function respawnPm(
	team: Team,
	userMessage: string,
	callbacks: Callbacks,
): Promise<{ agent: Agent; persistent: PersistentAgentResult }> {
	log('pm', 'respawning PM', { teamId: team.id })
	const agentId = generateId()
	const mcpTools = createGroveTools(team.id, agentId)
	const persistent = await spawnPersistentAgent({
		agentId,
		teamId: team.id,
		role: 'pm',
		prompt: PM_RESUME_PROMPT(team, userMessage),
		contentBlocks: callbacks.contentBlocks,
		cwd: team.worktreePath,
		maxBudgetUsd: 10,
		allowedTools: ['mcp__grove__*'],
		canUseTool: buildPmCanUseTool(team.id, agentId),
		mcpTools,
		onDone: callbacks.onDone,
		onError: callbacks.onError,
	})
	return { agent: persistent.agent, persistent }
}
