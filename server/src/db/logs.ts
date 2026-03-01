import { and, asc, desc, eq, gt } from 'drizzle-orm'
import type { TeamLog } from '../types'
import { getDb } from './index'
import { logs } from './schema'

type LogListener = (log: TeamLog) => void
const listeners = new Map<string, Set<LogListener>>()

export function subscribeToTeamLogs(
	teamId: string,
	fn: LogListener,
): () => void {
	const set = listeners.get(teamId) ?? new Set()
	set.add(fn)
	listeners.set(teamId, set)
	return () => {
		set.delete(fn)
		if (set.size === 0) listeners.delete(teamId)
	}
}

export function dbInsertLog(
	teamId: string,
	type: string,
	payload: Record<string, unknown>,
): TeamLog {
	const now = Date.now()
	const result = getDb()
		.insert(logs)
		.values({
			teamId,
			type,
			payload: JSON.stringify(payload),
			createdAt: now,
		})
		.run() as unknown as { lastInsertRowid: number }
	const log: TeamLog = {
		id: Number(result.lastInsertRowid),
		teamId,
		type,
		payload: JSON.stringify(payload),
		createdAt: now,
	}
	for (const fn of listeners.get(teamId) ?? []) fn(log)
	return log
}

export function dbListLogsSince(teamId: string, since: number): TeamLog[] {
	return getDb()
		.select()
		.from(logs)
		.where(and(eq(logs.teamId, teamId), gt(logs.createdAt, since)))
		.orderBy(asc(logs.createdAt))
		.all()
}

export function dbGetLatestLogByType(
	teamId: string,
	type: string,
): TeamLog | null {
	return (
		getDb()
			.select()
			.from(logs)
			.where(and(eq(logs.teamId, teamId), eq(logs.type, type)))
			.orderBy(desc(logs.createdAt))
			.limit(1)
			.get() ?? null
	)
}
