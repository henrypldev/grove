import { and, asc, desc, eq, gt, sql } from 'drizzle-orm'
import type { TeamEvent } from '../types'
import { getDb } from './index'
import { events, pmReports } from './schema'

type EventListener = (event: TeamEvent) => void
const listeners = new Map<string, Set<EventListener>>()

export function subscribeToTeamEvents(
	teamId: string,
	fn: EventListener,
): () => void {
	const set = listeners.get(teamId) ?? new Set()
	set.add(fn)
	listeners.set(teamId, set)
	return () => {
		set.delete(fn)
		if (set.size === 0) listeners.delete(teamId)
	}
}

export function dbInsertEvent(
	teamId: string,
	agentId: string | null,
	type: string,
	payload: Record<string, unknown>,
): TeamEvent {
	const now = Date.now()
	const result = getDb()
		.insert(events)
		.values({
			teamId,
			agentId,
			type,
			payload: JSON.stringify(payload),
			createdAt: now,
		})
		.run()
	const event: TeamEvent = {
		id: Number(result.lastInsertRowid),
		teamId,
		agentId,
		type,
		payload: JSON.stringify(payload),
		createdAt: now,
	}
	listeners.get(teamId)?.forEach((fn) => fn(event))
	return event
}

export function dbListEventsSince(
	teamId: string,
	since: number,
): TeamEvent[] {
	return getDb()
		.select()
		.from(events)
		.where(and(eq(events.teamId, teamId), gt(events.createdAt, since)))
		.orderBy(asc(events.createdAt))
		.all()
}

export function dbGetLatestEventId(): number {
	const row = getDb()
		.select({ id: sql<number>`max(${events.id})` })
		.from(events)
		.get()
	return row?.id ?? 0
}

export function dbGetEventsSinceId(sinceId: number): TeamEvent[] {
	return getDb()
		.select()
		.from(events)
		.where(gt(events.id, sinceId))
		.orderBy(asc(events.id))
		.limit(500)
		.all()
}

export function dbGetLatestEventByType(
	teamId: string,
	type: string,
): TeamEvent | null {
	return (
		getDb()
			.select()
			.from(events)
			.where(and(eq(events.teamId, teamId), eq(events.type, type)))
			.orderBy(desc(events.createdAt))
			.limit(1)
			.get() ?? null
	)
}

export function emitEphemeralEvent(
	teamId: string,
	agentId: string,
	type: string,
	payload: Record<string, unknown>,
): void {
	const event: TeamEvent = {
		id: -1,
		teamId,
		agentId,
		type,
		payload: JSON.stringify(payload),
		createdAt: Date.now(),
	}
	listeners.get(teamId)?.forEach((fn) => fn(event))
}

export function dbInsertPmReport(teamId: string, summary: string): void {
	getDb()
		.insert(pmReports)
		.values({ teamId, summary, createdAt: Date.now() })
		.run()
}
