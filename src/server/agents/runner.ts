import type {
	CanUseTool,
	PostToolUseFailureHookInput,
	PostToolUseHookInput,
	PreToolUseHookInput,
	Query,
	SettingSource,
} from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { which } from 'bun'
import { generateId, log } from '../config'

let cachedClaudePath: string | undefined

async function getClaudeCodePath(): Promise<string | undefined> {
	if (cachedClaudePath !== undefined) return cachedClaudePath
	const resolved = which('claude')
	cachedClaudePath = resolved ?? undefined
	return cachedClaudePath
}

import { dbInsertActivity, emitEphemeralActivity } from '../db/activity'
import {
	dbGetAgent,
	dbIncrementAgentRetry,
	dbInsertAgent,
	dbUpdateAgentActivity,
	dbUpdateAgentSessionId,
	dbUpdateAgentStatus,
} from '../db/agents'
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

/** Clean up in-memory state for a closed agent session. */
export function cleanupAgentSession(agentId: string) {
	agentToolAccumulator.delete(agentId)
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
	canUseTool?: CanUseTool
	mcpTools?: ReturnType<typeof createGroveTools>
	onPostBash?: (command: string) => void
	settingSources?: SettingSource[]
	onDone?: (agentId: string) => void
	onError?: (agentId: string, error: unknown) => void
	/** Skip role-based registry registration (used for task-scoped agents that register separately). */
	skipRoleRegistry?: boolean
	/** Task ID for task-scoped dev agents (stored in DB for frontend display). */
	taskId?: string
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
		taskId: opts.taskId ?? null,
		retryCount: 0,
		spawnedAt: now,
		updatedAt: now,
	}
	dbInsertAgent(agent)

	runAgentSession(agent, opts).catch(err => {
		log('agent', `unhandled error in ${opts.role}`, { agentId, err })
		dbUpdateAgentStatus(agentId, opts.teamId, 'error')
		opts.onError?.(agentId, err)
	})

	return agent
}

async function runAgentSession(agent: Agent, opts: AgentRunOptions) {
	dbUpdateAgentStatus(agent.id, agent.teamId, 'working')
	const pending = new Map<string, ToolCall>()
	const claudePath = await getClaudeCodePath()

	try {
		for await (const message of query({
			prompt: opts.prompt,
			options: {
				cwd: opts.cwd,
				maxBudgetUsd: opts.maxBudgetUsd ?? 5,
				permissionMode: 'bypassPermissions',
				...(opts.mcpTools ? { mcpServers: { grove: opts.mcpTools } } : {}),
				allowedTools: [...(opts.allowedTools ?? []), 'Skill'],
				settingSources: opts.settingSources ?? ['user', 'project'],
				...(opts.canUseTool ? { canUseTool: opts.canUseTool } : {}),
				hooks: buildHooks(agent, pending, opts),
				...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
			},
		})) {
			if (message.type !== 'user') {
				dbInsertActivity(
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
					dbUpdateAgentStatus(agent.id, agent.teamId, 'done')
					opts.onDone?.(agent.id)
				} else {
					log('agent', `${opts.role} finished with error: ${message.subtype}`, {
						agentId: agent.id,
						message,
					})
					dbUpdateAgentStatus(agent.id, agent.teamId, 'error')
					opts.onError?.(agent.id, new Error(message.subtype))
				}
			}
		}
	} catch (err) {
		log('agent', `${opts.role} threw error`, { agentId: agent.id, err })
		dbUpdateAgentStatus(agent.id, agent.teamId, 'error')
		opts.onError?.(agent.id, err)
		throw err
	}
}

export interface PersistentAgentResult {
	agent: Agent
	queue: MessageQueue
	query: Query
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
		taskId: opts.taskId ?? null,
		retryCount: 0,
		spawnedAt: now,
		updatedAt: now,
	}
	dbInsertAgent(agent)
	dbUpdateAgentStatus(agent.id, agent.teamId, 'working')

	const messageQueue = new MessageQueue()
	const pending = new Map<string, ToolCall>()
	const claudePath = await getClaudeCodePath()

	messageQueue.push(opts.prompt)
	if (opts.contentBlocks) {
		messageQueue.pushContent(opts.contentBlocks)
	}

	const q = query({
		prompt: messageQueue,
		options: {
			cwd: opts.cwd,
			maxBudgetUsd: opts.maxBudgetUsd ?? 5,
			permissionMode: 'bypassPermissions',
			...(opts.mcpTools ? { mcpServers: { grove: opts.mcpTools } } : {}),
			allowedTools: [...(opts.allowedTools ?? []), 'Skill'],
			settingSources: opts.settingSources ?? ['user', 'project'],
			...(opts.canUseTool ? { canUseTool: opts.canUseTool } : {}),
			hooks: buildHooks(agent, pending, opts),
			...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
		},
	})

	if (!opts.skipRoleRegistry) {
		registerAgent(opts.teamId, opts.role, {
			agentId,
			queue: messageQueue,
			query: q,
		})
	}

	processMessages(q, agent, opts, messageQueue).catch(err => {
		log('agent', `unhandled error in persistent ${opts.role}`, { agentId, err })
		dbUpdateAgentStatus(agentId, opts.teamId, 'error')
		opts.onError?.(agentId, err)
	})

	return { agent, queue: messageQueue, query: q }
}

async function processMessages(
	q: Query,
	agent: Agent,
	opts: AgentRunOptions,
	messageQueue?: MessageQueue,
) {
	try {
		for await (const message of q) {
			if (message.type !== 'user') {
				dbInsertActivity(
					agent.teamId,
					agent.id,
					`sdk:${message.type}`,
					message as Record<string, unknown>,
				)
			}

			if (message.type === 'system' && message.subtype === 'init') {
				dbUpdateAgentSessionId(agent.id, message.session_id)
				if (messageQueue) {
					messageQueue.sessionId = message.session_id
				}
			}

			if (message.type === 'result') {
				recordUsage(agent, message as unknown as Record<string, unknown>)
				if (messageQueue) {
					if (message.subtype === 'success') {
						dbUpdateAgentStatus(agent.id, agent.teamId, 'idle')
					} else {
						log(
							'agent',
							`persistent ${opts.role} finished with error: ${message.subtype}`,
							{ agentId: agent.id, message },
						)
						dbUpdateAgentStatus(agent.id, agent.teamId, 'error')
						opts.onError?.(agent.id, new Error(message.subtype))
					}
				} else {
					if (message.subtype === 'success') {
						dbUpdateAgentStatus(agent.id, agent.teamId, 'done')
						opts.onDone?.(agent.id)
					} else {
						log(
							'agent',
							`${opts.role} finished with error: ${message.subtype}`,
							{ agentId: agent.id, message },
						)
						dbUpdateAgentStatus(agent.id, agent.teamId, 'error')
						opts.onError?.(agent.id, new Error(message.subtype))
					}
				}
			}
		}
		if (messageQueue) {
			dbUpdateAgentStatus(agent.id, agent.teamId, 'done')
			opts.onDone?.(agent.id)
		}
	} catch (err) {
		log('agent', `${opts.role} threw error`, { agentId: agent.id, err })
		dbUpdateAgentStatus(agent.id, agent.teamId, 'error')
		opts.onError?.(agent.id, err)
		throw err
	}
}

function stripToolInput(
	toolName: string,
	toolInput: unknown,
): Record<string, unknown> | undefined {
	if (!toolInput || typeof toolInput !== 'object') return undefined
	const raw = toolInput as Record<string, unknown>
	switch (toolName) {
		case 'Read':
			return pick(raw, ['file_path', 'offset', 'limit'])
		case 'Write':
			return pick(raw, ['file_path'])
		case 'Edit':
			return pick(raw, ['file_path'])
		case 'Bash':
		case 'BashOutput':
			return pick(raw, ['command', 'description', 'timeout'])
		case 'Glob':
			return pick(raw, ['pattern', 'path'])
		case 'Grep':
			return pick(raw, ['pattern', 'path', 'glob', 'type'])
		case 'WebFetch':
			return pick(raw, ['url'])
		case 'WebSearch':
			return pick(raw, ['query'])
		case 'Task':
		case 'Agent':
			return pick(raw, ['description', 'prompt'])
		case 'NotebookEdit':
			return pick(raw, ['notebook_path', 'cell_id', 'type'])
		default:
			// For unknown tools, include only string/number/boolean values under 200 chars
			return Object.fromEntries(
				Object.entries(raw).filter(
					([, v]) =>
						(typeof v === 'string' && v.length < 200) ||
						typeof v === 'number' ||
						typeof v === 'boolean',
				),
			)
	}
}

function pick(
	obj: Record<string, unknown>,
	keys: string[],
): Record<string, unknown> {
	const result: Record<string, unknown> = {}
	for (const key of keys) {
		if (key in obj) result[key] = obj[key]
	}
	return result
}

function buildHooks(
	agent: Agent,
	pending: Map<string, ToolCall>,
	opts: AgentRunOptions,
) {
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
						dbUpdateAgentActivity(agent.id, agent.teamId, activity)
						emitEphemeralActivity(
							agent.teamId,
							agent.id,
							'agent:status_change',
							{
								status: 'working',
								activity,
							},
						)
						const strippedInput = stripToolInput(h.tool_name, h.tool_input)
						dbInsertActivity(agent.teamId, agent.id, 'agent:tool_use', {
							tool: h.tool_name,
							...(strippedInput ? { input: strippedInput } : {}),
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

							if (
								opts.onPostBash &&
								call.name === 'Bash' &&
								typeof call.input === 'object' &&
								call.input !== null &&
								'command' in call.input
							) {
								opts.onPostBash((call.input as { command: string }).command)
							}
						}
						dbUpdateAgentActivity(agent.id, agent.teamId, null)
						emitEphemeralActivity(
							agent.teamId,
							agent.id,
							'agent:status_change',
							{
								status: 'working',
								activity: null,
							},
						)
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
						dbUpdateAgentActivity(agent.id, agent.teamId, null)
						emitEphemeralActivity(
							agent.teamId,
							agent.id,
							'agent:status_change',
							{
								status: 'working',
								activity: null,
							},
						)
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
		dbUpdateAgentStatus(agentId, agent.teamId, 'error')
		return false
	}
	dbUpdateAgentStatus(agentId, agent.teamId, 'planning')
	runAgentSession(agent, {
		teamId: agent.teamId,
		role: agent.role,
		prompt,
		cwd,
		onDone,
		onError,
	}).catch(err => {
		log('agent', `respawn session error for ${agent.role}`, { agentId, err })
	})
	return true
}
