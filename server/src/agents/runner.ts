import type {
	PostToolUseFailureHookInput,
	PostToolUseHookInput,
	PreToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk'
import {
	unstable_v2_createSession,
	unstable_v2_prompt,
} from '@anthropic-ai/claude-agent-sdk'
import { generateId, log } from '../config'
import {
	dbGetAgent,
	dbIncrementAgentRetry,
	dbInsertAgent,
	dbUpdateAgentActivity,
	dbUpdateAgentSessionId,
	dbUpdateAgentStatus,
} from '../db/agents'
import { dbInsertEvent, emitEphemeralEvent } from '../db/events'
import { dbInsertUsage } from '../db/usage'
import type { Agent, AgentRole, ToolCall } from '../types'
import { registerAgent } from './agent-registry'
import type { createGroveTools } from './grove-tools'
import { MessageQueue } from './message-queue'

const agentToolAccumulator = new Map<string, ToolCall[]>()

export function popAgentTools(agentId: string): ToolCall[] {
	const tools = agentToolAccumulator.get(agentId) ?? []
	agentToolAccumulator.delete(agentId)
	return tools
}

export interface AgentRunOptions {
	agentId?: string
	teamId: string
	role: AgentRole
	prompt: string
	contentBlocks?: unknown[]
	cwd: string
	maxBudgetUsd?: number
	allowedTools?: string[]
	mcpTools?: ReturnType<typeof createGroveTools>
	onDone?: (agentId: string) => void
	onError?: (agentId: string, error: unknown) => void
}

export function activityFromToolName(toolName: string): string {
	if (['Bash', 'BashOutput', 'KillShell'].includes(toolName))
		return 'running commands'
	if (['Read', 'Glob', 'Grep'].includes(toolName)) return 'reading files'
	if (['Edit', 'Write', 'NotebookEdit'].includes(toolName))
		return 'writing code'
	if (['WebFetch', 'WebSearch'].includes(toolName)) return 'researching'
	if (toolName === 'Task') return 'spawning agents'
	if (toolName === 'SendMessage') return 'communicating'
	return 'working'
}

export async function spawnAgent(opts: AgentRunOptions): Promise<Agent> {
	const agentId = opts.agentId ?? generateId()
	const now = Date.now()
	const agent: Agent = {
		id: agentId,
		teamId: opts.teamId,
		role: opts.role,
		status: 'planning',
		activity: null,
		currentTask: opts.prompt.slice(0, 200),
		sessionId: null,
		retryCount: 0,
		spawnedAt: now,
		updatedAt: now,
	}
	dbInsertAgent(agent)

	runAgentSession(agent, opts).catch(err => {
		log('agent', `unhandled error in ${opts.role}`, { agentId, err })
		dbUpdateAgentStatus(agentId, 'error')
		opts.onError?.(agentId, err)
	})

	return agent
}

async function runAgentSession(agent: Agent, opts: AgentRunOptions) {
	dbUpdateAgentStatus(agent.id, 'working')
	const pending = new Map<string, ToolCall>()

	try {
		const result = await unstable_v2_prompt(opts.prompt, {
			cwd: opts.cwd,
			maxBudgetUsd: opts.maxBudgetUsd ?? 5,
			permissionMode: 'bypassPermissions',
			...(opts.mcpTools ? { mcpServers: { grove: opts.mcpTools } } : {}),
			...(opts.allowedTools ? { allowedTools: opts.allowedTools } : {}),
			hooks: buildHooks(agent, pending),
		})

		if (result.session_id) {
			dbUpdateAgentSessionId(agent.id, result.session_id)
		}
		recordUsage(agent, result as unknown as Record<string, unknown>)
		dbUpdateAgentStatus(agent.id, 'done')
		opts.onDone?.(agent.id)
	} catch (err) {
		dbUpdateAgentStatus(agent.id, 'error')
		opts.onError?.(agent.id, err)
		throw err
	}
}

export interface PersistentAgentResult {
	agent: Agent
	queue: MessageQueue
}

export async function spawnPersistentAgent(
	opts: AgentRunOptions,
): Promise<PersistentAgentResult> {
	const agentId = opts.agentId ?? generateId()
	const now = Date.now()
	const agent: Agent = {
		id: agentId,
		teamId: opts.teamId,
		role: opts.role,
		status: 'planning',
		activity: null,
		currentTask: opts.prompt.slice(0, 200),
		sessionId: null,
		retryCount: 0,
		spawnedAt: now,
		updatedAt: now,
	}
	dbInsertAgent(agent)
	dbUpdateAgentStatus(agent.id, 'working')

	const messageQueue = new MessageQueue()
	messageQueue.push(opts.prompt)
	if (opts.contentBlocks) {
		messageQueue.pushContent(opts.contentBlocks as unknown[])
	}

	const pending = new Map<string, ToolCall>()

	const session = unstable_v2_createSession({
		cwd: opts.cwd,
		maxBudgetUsd: opts.maxBudgetUsd ?? 5,
		permissionMode: 'bypassPermissions',
		...(opts.mcpTools ? { mcpServers: { grove: opts.mcpTools } } : {}),
		...(opts.allowedTools ? { allowedTools: opts.allowedTools } : {}),
		hooks: buildHooks(agent, pending),
	})

	registerAgent(opts.teamId, opts.role, {
		agentId,
		queue: messageQueue,
		session,
	})

	runPersistentLoop(session, agent, opts, messageQueue).catch(err => {
		log('agent', `unhandled error in persistent ${opts.role}`, { agentId, err })
		dbUpdateAgentStatus(agentId, 'error')
		opts.onError?.(agentId, err)
	})

	return { agent, queue: messageQueue }
}

async function runPersistentLoop(
	session: ReturnType<typeof unstable_v2_createSession>,
	agent: Agent,
	opts: AgentRunOptions,
	queue: MessageQueue,
) {
	try {
		while (true) {
			const item = await queue.dequeue()
			if (!item) break

			const text =
				item.type === 'text'
					? item.text
					: JSON.stringify(item.content)
			await session.send(text)

			for await (const message of session.stream()) {
				if (message.type !== 'user') {
					dbInsertEvent(
						agent.teamId,
						agent.id,
						`sdk:${message.type}`,
						message as Record<string, unknown>,
					)
				}

				if (message.type === 'system' && message.subtype === 'init') {
					dbUpdateAgentSessionId(agent.id, message.session_id)
				}

				if (message.type === 'result') {
					recordUsage(agent, message as unknown as Record<string, unknown>)
					if (message.subtype === 'success') {
						dbUpdateAgentStatus(agent.id, 'idle')
					} else {
						dbUpdateAgentStatus(agent.id, 'error')
						opts.onError?.(agent.id, new Error(message.subtype))
					}
				}
			}
		}
		dbUpdateAgentStatus(agent.id, 'done')
		opts.onDone?.(agent.id)
	} catch (err) {
		dbUpdateAgentStatus(agent.id, 'error')
		opts.onError?.(agent.id, err)
		throw err
	}
}

function buildHooks(agent: Agent, pending: Map<string, ToolCall>) {
	return {
		PreToolUse: [
			{
				hooks: [
					async (input: unknown) => {
						const h = input as PreToolUseHookInput
						pending.set(h.tool_use_id, {
							name: h.tool_name,
							input: h.tool_input,
						})
						const activity = activityFromToolName(h.tool_name)
						dbUpdateAgentActivity(agent.id, activity)
						emitEphemeralEvent(agent.teamId, agent.id, 'agent:status_change', {
							status: 'working',
							activity,
						})
						return {}
					},
				],
			},
		],
		PostToolUse: [
			{
				hooks: [
					async (input: unknown) => {
						const h = input as PostToolUseHookInput
						const call = pending.get(h.tool_use_id)
						if (call) {
							call.output = h.tool_response
							const arr = agentToolAccumulator.get(agent.id) ?? []
							arr.push(call)
							agentToolAccumulator.set(agent.id, arr)
							pending.delete(h.tool_use_id)
						}
						dbUpdateAgentActivity(agent.id, null)
						emitEphemeralEvent(agent.teamId, agent.id, 'agent:status_change', {
							status: 'working',
							activity: null,
						})
						return {}
					},
				],
			},
		],
		PostToolUseFailure: [
			{
				hooks: [
					async (input: unknown) => {
						const h = input as PostToolUseFailureHookInput
						const call = pending.get(h.tool_use_id)
						if (call) {
							call.error = h.error
							const arr = agentToolAccumulator.get(agent.id) ?? []
							arr.push(call)
							agentToolAccumulator.set(agent.id, arr)
							pending.delete(h.tool_use_id)
						}
						dbUpdateAgentActivity(agent.id, null)
						emitEphemeralEvent(agent.teamId, agent.id, 'agent:status_change', {
							status: 'working',
							activity: null,
						})
						return {}
					},
				],
			},
		],
	}
}

function recordUsage(agent: Agent, message: Record<string, unknown>) {
	const modelUsage = message.modelUsage as
		| Record<string, Record<string, number>>
		| undefined
	if (!modelUsage) return
	for (const [model, mu] of Object.entries(modelUsage)) {
		dbInsertUsage({
			teamId: agent.teamId,
			agentId: agent.id,
			model,
			inputTokens: mu.inputTokens ?? 0,
			outputTokens: mu.outputTokens ?? 0,
			cacheReadTokens: mu.cacheReadInputTokens ?? 0,
			cacheCreationTokens: mu.cacheCreationInputTokens ?? 0,
			costUsd: mu.costUSD ?? 0,
			durationMs: (message.duration_ms as number) ?? 0,
			durationApiMs: (message.duration_api_ms as number) ?? 0,
			numTurns: (message.num_turns as number) ?? 0,
			createdAt: Date.now(),
		})
	}
}

export async function respawnAgent(
	agentId: string,
	prompt: string,
	cwd: string,
	onDone?: (agentId: string) => void,
	onError?: (agentId: string, err: unknown) => void,
): Promise<boolean> {
	const agent = dbGetAgent(agentId)
	if (!agent) return false
	const retries = dbIncrementAgentRetry(agentId)
	if (retries > 3) {
		dbUpdateAgentStatus(agentId, 'error')
		return false
	}
	dbUpdateAgentStatus(agentId, 'planning')
	runAgentSession(agent, {
		teamId: agent.teamId,
		role: agent.role,
		prompt,
		cwd,
		onDone,
		onError,
	}).catch(() => {})
	return true
}
