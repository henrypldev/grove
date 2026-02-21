import type { TeamEvent } from '../types'
import { getDb } from './index'

export function dbInsertEvent(
	teamId: string,
	agentId: string,
	type: string,
	payload: Record<string, unknown>,
): TeamEvent {
	const now = Date.now()
	const result = getDb().run(
		'INSERT INTO events (team_id, agent_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)',
		[teamId, agentId, type, JSON.stringify(payload), now],
	)
	return {
		id: Number(result.lastInsertRowid),
		teamId,
		agentId,
		type,
		payload: JSON.stringify(payload),
		createdAt: now,
	}
}

export function dbListEventsSince(
	teamId: string,
	since: number,
	limit = 200,
): TeamEvent[] {
	return getDb()
		.query<TeamEvent, [string, number, number]>(
			'SELECT * FROM events WHERE team_id = ? AND created_at > ? ORDER BY created_at ASC LIMIT ?',
		)
		.all(teamId, since, limit)
}

export function dbGetLatestEventId(): number {
	const row = getDb()
		.query<{ id: number | null }, []>('SELECT MAX(id) as id FROM events')
		.get()
	return row?.id ?? 0
}

export function dbGetEventsSinceId(sinceId: number): TeamEvent[] {
	return getDb()
		.query<TeamEvent, [number]>(
			'SELECT * FROM events WHERE id > ? ORDER BY id ASC LIMIT 500',
		)
		.all(sinceId)
}

export function dbGetLatestEventByType(
	teamId: string,
	type: string,
): TeamEvent | null {
	return (
		getDb()
			.query<TeamEvent, [string, string]>(
				'SELECT * FROM events WHERE team_id = ? AND type = ? ORDER BY created_at DESC LIMIT 1',
			)
			.get(teamId, type) ?? null
	)
}

export function dbInsertPmReport(teamId: string, summary: string): void {
	getDb().run(
		'INSERT INTO pm_reports (team_id, summary, created_at) VALUES (?, ?, ?)',
		[teamId, summary, Date.now()],
	)
}
