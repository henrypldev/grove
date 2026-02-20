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
	teamId: string
	role: AgentRole
	prompt: string
	cwd: string
	maxBudgetUsd?: number
	onDone?: (agentId: string) => void
	onError?: (agentId: string, error: unknown) => void
}

export async function spawnAgent(opts: AgentRunOptions): Promise<Agent> {
	const agentId = generateId()
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

	const args = [
		'claude',
		'--print',
		'--output-format',
		'stream-json',
		'--dangerously-skip-permissions',
		'--max-budget-usd',
		String(opts.maxBudgetUsd ?? 5),
		opts.prompt,
	]

	const proc = Bun.spawn(args, {
		cwd: opts.cwd,
		stdout: 'pipe',
		stderr: 'pipe',
	})

	try {
		const decoder = new TextDecoder()
		let buf = ''

		for await (const chunk of proc.stdout) {
			buf += decoder.decode(chunk, { stream: true })
			const lines = buf.split('\n')
			buf = lines.pop() ?? ''

			for (const line of lines) {
				const trimmed = line.trim()
				if (!trimmed) continue
				try {
					const msg = JSON.parse(trimmed) as Record<string, unknown>
					const msgType = (msg.type as string) ?? 'unknown'

					dbInsertEvent(agent.teamId, agent.id, `sdk:${msgType}`, msg)

					if (msgType === 'result') {
						const sessionId = msg.session_id as string | undefined
						if (sessionId) dbUpdateAgentSessionId(agent.id, sessionId)
					}
				} catch {
					// skip non-JSON lines
				}
			}
		}

		await proc.exited
		dbUpdateAgentStatus(agent.id, 'done')
		opts.onDone?.(agent.id)
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
	}).catch(() => {})
	return true
}
