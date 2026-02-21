import { query } from '@anthropic-ai/claude-agent-sdk'
import { generateId, log } from '../config'
import {
	dbGetAgent,
	dbIncrementAgentRetry,
	dbInsertAgent,
	dbUpdateAgentSessionId,
	dbUpdateAgentStatus,
} from '../db/agents'
import { dbInsertEvent } from '../db/events'
import type { Agent, AgentRole } from '../types'

export interface AgentRunOptions {
	agentId?: string
	teamId: string
	role: AgentRole
	prompt: string
	cwd: string
	maxBudgetUsd?: number
	allowedTools?: string[]
	onDone?: (agentId: string) => void
	onError?: (agentId: string, error: unknown) => void
}

export async function spawnAgent(opts: AgentRunOptions): Promise<Agent> {
	const agentId = opts.agentId ?? generateId()
	const now = Date.now()
	const agent: Agent = {
		id: agentId,
		teamId: opts.teamId,
		role: opts.role,
		status: 'planning',
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

	try {
		for await (const message of query({
			prompt: opts.prompt,
			options: {
				cwd: opts.cwd,
				maxBudgetUsd: opts.maxBudgetUsd ?? 5,
				permissionMode: 'bypassPermissions',
				...(opts.allowedTools ? { allowedTools: opts.allowedTools } : {}),
			},
		})) {
			dbInsertEvent(
				agent.teamId,
				agent.id,
				`sdk:${message.type}`,
				message as Record<string, unknown>,
			)

			if (message.type === 'system' && message.subtype === 'init') {
				dbUpdateAgentSessionId(agent.id, message.session_id)
			}

			if (message.type === 'result') {
				if (message.subtype === 'success') {
					dbUpdateAgentStatus(agent.id, 'done')
					opts.onDone?.(agent.id)
				} else {
					dbUpdateAgentStatus(agent.id, 'error')
					opts.onError?.(agent.id, new Error(message.subtype))
				}
			}
		}
	} catch (err) {
		dbUpdateAgentStatus(agent.id, 'error')
		opts.onError?.(agent.id, err)
		throw err
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
