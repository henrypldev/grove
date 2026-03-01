import type { TeamLog } from '../types'

type LogListener = (log: TeamLog) => void
const listeners = new Map<string, Set<LogListener>>()

const store = new Map<string, TeamLog[]>()
let nextId = 1

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

export function clearTeamLogs(teamId: string): void {
	store.delete(teamId)
}

export function dbInsertLog(
	teamId: string,
	type: string,
	payload: Record<string, unknown>,
): TeamLog {
	const now = Date.now()
	const log: TeamLog = {
		id: nextId++,
		teamId,
		type,
		payload: JSON.stringify(payload),
		createdAt: now,
	}
	const logs = store.get(teamId) ?? []
	logs.push(log)
	store.set(teamId, logs)
	for (const fn of listeners.get(teamId) ?? []) fn(log)
	return log
}

export function dbListLogsSince(teamId: string, since: number): TeamLog[] {
	const logs = store.get(teamId) ?? []
	return logs.filter(l => l.createdAt > since)
}

export function dbGetLatestLogByType(
	teamId: string,
	type: string,
): TeamLog | null {
	const logs = store.get(teamId) ?? []
	for (let i = logs.length - 1; i >= 0; i--) {
		if (logs[i].type === type) return logs[i]
	}
	return null
}
