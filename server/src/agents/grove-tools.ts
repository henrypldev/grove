import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { dbInsertEvent, dbListEventsSince } from '../db/events'
import type { AgentRole } from '../types'

export type SpawnRoleFn = (role: AgentRole) => Promise<void>

export function createGroveTools(teamId: string, agentId: string, spawnRole?: SpawnRoleFn) {
	return createSdkMcpServer({
		name: 'grove',
		version: '1.0.0',
		tools: [
			tool(
				'post_event',
				'Post an event to this team',
				{
					type: z.string().describe('Event type, e.g. "pm:plan" or "agent:message"'),
					payload: z.record(z.string(), z.unknown()).describe('Event payload as a JSON object'),
				},
				async ({ type, payload }) => {
					dbInsertEvent(teamId, agentId, type, payload as Record<string, unknown>)
					return { content: [{ type: 'text' as const, text: 'ok' }] }
				},
			),
			tool(
				'get_events',
				'Get all team events since a timestamp',
				{
					since: z.number().optional().describe('Unix ms timestamp. Defaults to 0 (all events)'),
				},
				async ({ since }) => {
					const events = dbListEventsSince(teamId, since ?? 0)
					const parsed = events.map(e => ({
						...e,
						payload: JSON.parse(e.payload),
					}))
					return { content: [{ type: 'text' as const, text: JSON.stringify(parsed) }] }
				},
			),
			tool(
				'spawn_agent',
				'Spawn a new agent for this team',
				{
					role: z
						.enum(['team-lead', 'dev', 'qa', 'reviewer'])
						.describe('Role of the agent to spawn'),
				},
				async ({ role }) => {
					if (!spawnRole) {
						return { content: [{ type: 'text' as const, text: 'error: spawn not available' }] }
					}
					await spawnRole(role as AgentRole)
					return { content: [{ type: 'text' as const, text: `spawned ${role}` }] }
				},
			),
			tool(
				'wait_for_event',
				'Block until an event with one of the given types arrives',
				{
					types: z.array(z.string()).describe('Event types to wait for'),
					timeout_ms: z
						.number()
						.optional()
						.describe('Timeout in ms. Defaults to 300000 (5 minutes)'),
				},
				async ({ types, timeout_ms = 300_000 }) => {
					const deadline = Date.now() + timeout_ms
					let since = Date.now()
					while (Date.now() < deadline) {
						const events = dbListEventsSince(teamId, since)
						const match = events.find(e => types.includes(e.type))
						if (match) {
							return {
								content: [
									{
										type: 'text' as const,
										text: JSON.stringify({ ...match, payload: JSON.parse(match.payload) }),
									},
								],
							}
						}
						if (events.length > 0) {
							since = events[events.length - 1].createdAt
						}
						await new Promise(r => setTimeout(r, 1000))
					}
					return {
						content: [{ type: 'text' as const, text: JSON.stringify({ error: 'timeout' }) }],
					}
				},
			),
		],
	})
}
