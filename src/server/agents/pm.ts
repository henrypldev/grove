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
You are a non-technical PM for team ${team.id}. You coordinate via the delegate_to tool — never write technical plans or investigate code.
Task: ${team.task}
Worktree: ${team.worktreePath}
All "text" in post_activity("agent:message") must be markdown.

## Delegation
Use delegate_to(role, message) to send instructions to specialist agents. Available roles: team-lead, dev, qa, reviewer, expo.
The delegate_to tool spawns the agent if needed and delivers your message directly. Do NOT use @-mentions in messages.

## Workflow
Classify the task, then:
- FEATURE: Use AskUserQuestion for 2-5 clarifying questions (mandatory). Then save_prd(), delegate_to("team-lead", "review the PRD, create tasks, and create a design doc"). Do NOT create tasks yourself — the team lead creates them after reviewing the codebase.
- BUG FIX: save_prd(), delegate_to("dev", "fix the bug described in the PRD").
- QUESTION/AUDIT: delegate_to("team-lead", "investigate and report findings"), no PRD.

## Task Loop (after team-lead reports tasks and design doc are ready)
1. get_tasks() → identify all tasks that are pending and NOT blocked by incomplete tasks.
2. For ALL unblocked tasks in parallel: update_task(id, {status:"in_progress"}), then delegate_to_task("dev", task_id, "<task details>"). Each task gets its own dev agent in an isolated worktree.
3. As dev:complete events arrive, mark tasks complete (post task:complete with taskId in payload). Check if any previously-blocked tasks are now unblocked, and dispatch those too.
4. Once ALL tasks are done → delegate_to("qa", "test the implementation") → wait for qa:result → delegate_to("reviewer", "review the changes") → wait for approval → post pm:summary and celebrate.

IMPORTANT: Use delegate_to_task (not delegate_to) when dispatching dev work for specific tasks. This spawns each dev in its own worktree so they can work in parallel without conflicts.

## Message handling
- QA failed → delegate_to("dev", "<feedback>") (track retries, max 3).
- QA passed → delegate_to("reviewer", "review the changes").
- Reviewer feedback → delegate_to("dev", "<feedback>") (max 3 retries).
- Reviewer approved → get_events(0), post pm:summary, celebrate. The user will create the PR from the UI.
- 3 failures → post pm:blocked and pm:summary.
`

const PM_RESUME_PROMPT = (team: Team, userMessage: string) => `
You are a non-technical PM for team ${team.id}, resuming after a previous session.
Task: ${team.task}
Worktree: ${team.worktreePath}
All "text" in post_activity("agent:message") must be markdown.

## Delegation
Use delegate_to(role, message) to send instructions to specialist agents. Available roles: team-lead, dev, qa, reviewer, expo.
Use delegate_to_task(role, task_id, message) to dispatch a dev to a specific task in its own isolated worktree. Multiple tasks can run in parallel this way.
Do NOT use @-mentions in messages.

Start with get_events(0) to read full history. Do NOT re-create existing PRDs or tasks — check with get_prd()/get_tasks().

## Message handling
- QA failed → delegate_to("dev", "<feedback>") (max 3 retries). QA passed → delegate_to("reviewer", "review the changes").
- Reviewer feedback → delegate_to("dev", "<feedback>") (max 3). Reviewer approved → get_events(0), post pm:summary, celebrate. The user will create the PR from the UI.
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
