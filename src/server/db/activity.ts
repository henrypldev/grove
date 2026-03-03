import { and, asc, desc, eq, gt, sql } from 'drizzle-orm'
import type { TeamActivity } from '../types'
import { getDb } from './index'
import { activity, pmReports } from './schema'

type ActivityListener = (item: TeamActivity) => void
const listeners = new Map<string, Set<ActivityListener>>()

export function subscribeToTeamActivity(
	teamId: string,
	fn: ActivityListener,
): () => void {
	const set = listeners.get(teamId) ?? new Set()
	set.add(fn)
	listeners.set(teamId, set)
	return () => {
		set.delete(fn)
		if (set.size === 0) listeners.delete(teamId)
	}
}

export function dbInsertActivity(
	teamId: string,
	agentId: string | null,
	type: string,
	payload: Record<string, unknown>,
): TeamActivity {
	const now = Date.now()
	const result = getDb()
		.insert(activity)
		.values({
			teamId,
			agentId,
			type,
			payload: JSON.stringify(payload),
			createdAt: now,
		})
		.run() as unknown as { lastInsertRowid: number }
	const item: TeamActivity = {
		id: Number(result.lastInsertRowid),
		teamId,
		agentId,
		type,
		payload: JSON.stringify(payload),
		createdAt: now,
	}
	for (const fn of listeners.get(teamId) ?? []) fn(item)
	return item
}

export function dbListActivitySince(
	teamId: string,
	since: number,
): TeamActivity[] {
	return getDb()
		.select()
		.from(activity)
		.where(and(eq(activity.teamId, teamId), gt(activity.createdAt, since)))
		.orderBy(asc(activity.createdAt))
		.all()
}

export function dbGetLatestActivityId(): number {
	const row = getDb()
		.select({ id: sql<number>`max(${activity.id})` })
		.from(activity)
		.get()
	return row?.id ?? 0
}

export function dbGetActivitySinceId(sinceId: number): TeamActivity[] {
	return getDb()
		.select()
		.from(activity)
		.where(gt(activity.id, sinceId))
		.orderBy(asc(activity.id))
		.limit(500)
		.all()
}

export function dbGetLatestActivityByType(
	teamId: string,
	type: string,
): TeamActivity | null {
	return (
		getDb()
			.select()
			.from(activity)
			.where(and(eq(activity.teamId, teamId), eq(activity.type, type)))
			.orderBy(desc(activity.createdAt))
			.limit(1)
			.get() ?? null
	)
}

type GlobalActivityListener = (item: {
	type: string
	payload: Record<string, unknown>
}) => void
const globalListeners = new Set<GlobalActivityListener>()

export function subscribeToGlobalActivity(
	fn: GlobalActivityListener,
): () => void {
	globalListeners.add(fn)
	return () => {
		globalListeners.delete(fn)
	}
}

export function emitGlobalActivity(
	type: string,
	payload: Record<string, unknown>,
): void {
	const item = { type, payload }
	for (const fn of globalListeners) fn(item)
}

export function emitEphemeralActivity(
	teamId: string,
	agentId: string,
	type: string,
	payload: Record<string, unknown>,
): void {
	const item: TeamActivity = {
		id: -1,
		teamId,
		agentId,
		type,
		payload: JSON.stringify(payload),
		createdAt: Date.now(),
	}
	for (const fn of listeners.get(teamId) ?? []) fn(item)
}

export function dbInsertPmReport(teamId: string, summary: string): void {
	getDb()
		.insert(pmReports)
		.values({ teamId, summary, createdAt: Date.now() })
		.run()
}
