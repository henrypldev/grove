import { and, asc, eq, sql } from 'drizzle-orm'
import type { Agent, AgentRole, AgentStatus } from '../types'
import { broadcastToChannel } from '../websocket'
import { getDb } from './index'
import { agents } from './schema'

export function dbListAllAgents(): Agent[] {
	const rows = getDb()
		.select()
		.from(agents)
		.orderBy(asc(agents.spawnedAt))
		.all()
	return rows.map(toAgent)
}

export function dbListAgentsByTeam(teamId: string): Agent[] {
	const rows = getDb()
		.select()
		.from(agents)
		.where(eq(agents.teamId, teamId))
		.orderBy(asc(agents.spawnedAt))
		.all()
	return rows.map(toAgent)
}

export function dbGetAgentByTeamAndRole(
	teamId: string,
	role: AgentRole,
): Agent | null {
	const row = getDb()
		.select()
		.from(agents)
		.where(and(eq(agents.teamId, teamId), eq(agents.role, role)))
		.orderBy(asc(agents.spawnedAt))
		.limit(1)
		.get()
	return row ? toAgent(row) : null
}

export function dbGetAgent(id: string): Agent | null {
	const row = getDb().select().from(agents).where(eq(agents.id, id)).get()
	return row ? toAgent(row) : null
}

export function dbInsertAgent(agent: Agent): void {
	getDb()
		.insert(agents)
		.values({
			id: agent.id,
			teamId: agent.teamId,
			role: agent.role,
			status: agent.status,
			activity: agent.activity,
			currentTask: agent.currentTask,
			sessionId: agent.sessionId,
			taskId: agent.taskId,
			retryCount: agent.retryCount,
			spawnedAt: agent.spawnedAt,
			updatedAt: agent.updatedAt,
		})
		.run()
}

export function dbUpdateAgentActivity(
	id: string,
	teamId: string,
	activity: string | null,
): void {
	getDb()
		.update(agents)
		.set({ activity, updatedAt: Date.now() })
		.where(eq(agents.id, id))
		.run()
	broadcastToChannel(`team:${teamId}`, {
		type: 'agent:update',
		channel: `team:${teamId}`,
		data: { id, teamId, activity },
	})
}

export function dbUpdateAgentStatus(
	id: string,
	teamId: string,
	status: AgentStatus,
	currentTask?: string | null,
): void {
	getDb()
		.update(agents)
		.set({ status, currentTask: currentTask ?? null, updatedAt: Date.now() })
		.where(eq(agents.id, id))
		.run()
	broadcastToChannel(`team:${teamId}`, {
		type: 'agent:update',
		channel: `team:${teamId}`,
		data: {
			id,
			teamId,
			status,
			currentTask: currentTask ?? null,
		},
	})
}

export function dbUpdateAgentSessionId(id: string, sessionId: string): void {
	getDb()
		.update(agents)
		.set({ sessionId, updatedAt: Date.now() })
		.where(eq(agents.id, id))
		.run()
}

export function dbIncrementAgentRetry(id: string): number {
	getDb()
		.update(agents)
		.set({
			retryCount: sql`${agents.retryCount} + 1`,
			updatedAt: Date.now(),
		})
		.where(eq(agents.id, id))
		.run()
	const row = getDb()
		.select({ retryCount: agents.retryCount })
		.from(agents)
		.where(eq(agents.id, id))
		.get()
	return row?.retryCount ?? 0
}

function toAgent(row: typeof agents.$inferSelect): Agent {
	return {
		id: row.id,
		teamId: row.teamId,
		role: row.role as AgentRole,
		status: row.status as AgentStatus,
		activity: row.activity,
		currentTask: row.currentTask,
		sessionId: row.sessionId,
		taskId: row.taskId ?? null,
		retryCount: row.retryCount ?? 0,
		spawnedAt: row.spawnedAt,
		updatedAt: row.updatedAt,
	}
}
