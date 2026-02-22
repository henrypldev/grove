import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { dbInsertEvent, dbListEventsSince } from '../db/events'
import { dbGetPlan, dbInsertPlan } from '../db/plans'

export function createGroveTools(teamId: string, agentId: string) {
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
				'save_plan',
				'Store a PRD or technical plan in the database',
				{
					type: z.enum(['prd', 'technical']).describe('Plan type'),
					content: z.string().describe('The full plan content in markdown'),
				},
				async ({ type, content }) => {
					dbInsertPlan(teamId, agentId, type, content)
					return { content: [{ type: 'text' as const, text: `saved ${type} plan` }] }
				},
			),
			tool(
				'get_plan',
				'Retrieve the latest plan of a given type',
				{
					type: z.enum(['prd', 'technical']).describe('Plan type to retrieve'),
				},
				async ({ type }) => {
					const plan = dbGetPlan(teamId, type)
					if (!plan) {
						return { content: [{ type: 'text' as const, text: `no ${type} plan found` }] }
					}
					return { content: [{ type: 'text' as const, text: plan.content }] }
				},
			),
		],
	})
}
