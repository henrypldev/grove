import { and, asc, desc, eq, gt, sql } from 'drizzle-orm'
import type { TeamActivity } from '../types'
import { dbGetAgent } from './agents'
import { getDb } from './index'
import { activity, pmReports } from './schema'

type ActivityListener = (item: TeamActivity) => void | Promise<void>
const listeners = new Map<string, Set<ActivityListener>>()

function safeCall<T>(
	label: string,
	fn: (arg: T) => void | Promise<void>,
	arg: T,
) {
	try {
		const result = fn(arg)
		if (result && typeof result === 'object' && 'catch' in result) {
			;(result as Promise<void>).catch(err => {
				console.error(`[activity] ${label} async error`, err)
			})
		}
	} catch (err) {
		console.error(`[activity] ${label} sync error`, err)
	}
}

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
	// Inject agent identity into payload so the frontend can label activity
	let enriched = payload
	if (agentId) {
		const agent = dbGetAgent(agentId)
		if (agent) {
			enriched = {
				agentRole: agent.role,
				...(agent.taskId ? { taskId: agent.taskId } : {}),
				...payload,
			}
		}
	}
	const payloadStr = JSON.stringify(enriched)
	const result = getDb()
		.insert(activity)
		.values({
			teamId,
			agentId,
			type,
			payload: payloadStr,
			createdAt: now,
		})
		.run() as unknown as { lastInsertRowid: number }
	const item: TeamActivity = {
		id: Number(result.lastInsertRowid),
		teamId,
		agentId,
		type,
		payload: payloadStr,
		createdAt: now,
	}
	for (const fn of listeners.get(teamId) ?? []) {
		safeCall('team listener', fn, item)
	}
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

export function dbGetActivitySinceIdForTeam(
	sinceId: number,
	teamId: string,
): TeamActivity[] {
	return getDb()
		.select()
		.from(activity)
		.where(and(gt(activity.id, sinceId), eq(activity.teamId, teamId)))
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
}) => void | Promise<void>
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
	for (const fn of globalListeners) {
		safeCall('global listener', fn, item)
	}
}

// --- Ephemeral throttle ---
const ephemeralThrottles = new Map<
	string,
	{ timer: ReturnType<typeof setTimeout>; latest: TeamActivity }
>()

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
	const key = `${teamId}:${agentId}:${type}`
	const existing = ephemeralThrottles.get(key)
	if (existing) {
		// Coalesce: update latest, timer will fire it
		existing.latest = item
		return
	}
	// Leading edge: emit immediately, start coalesce window
	for (const fn of listeners.get(teamId) ?? []) {
		safeCall('ephemeral listener', fn, item)
	}
	const state = {
		timer: null as unknown as ReturnType<typeof setTimeout>,
		latest: item,
	}
	state.timer = setTimeout(() => {
		const current = ephemeralThrottles.get(key)
		ephemeralThrottles.delete(key)
		if (current && current.latest !== item) {
			for (const fn of listeners.get(teamId) ?? []) {
				safeCall('ephemeral listener', fn, current.latest)
			}
		}
	}, 100)
	ephemeralThrottles.set(key, state)
}

export function clearEphemeralThrottles(teamId: string): void {
	for (const [key, state] of ephemeralThrottles) {
		if (key.startsWith(`${teamId}:`)) {
			clearTimeout(state.timer)
			ephemeralThrottles.delete(key)
		}
	}
}

// --- Buffered ingestion ---
interface BufferedEntry {
	teamId: string
	agentId: string | null
	type: string
	payload: Record<string, unknown>
}

class ActivityBuffer {
	private queue: BufferedEntry[] = []
	private timer: ReturnType<typeof setTimeout> | null = null
	private readonly flushIntervalMs = 50
	private readonly maxBatchSize = 10

	enqueue(
		teamId: string,
		agentId: string | null,
		type: string,
		payload: Record<string, unknown>,
	): void {
		this.queue.push({ teamId, agentId, type, payload })
		if (this.queue.length >= this.maxBatchSize) {
			this.flush()
			return
		}
		if (!this.timer) {
			this.timer = setTimeout(() => this.flush(), this.flushIntervalMs)
		}
	}

	flushSync(): void {
		this.flush()
	}

	private flush(): void {
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
		}
		if (this.queue.length === 0) return
		const batch = this.queue.splice(0)
		const db = getDb()
		const items: TeamActivity[] = []
		const now = Date.now()

		db.transaction(tx => {
			for (const entry of batch) {
				let enriched = entry.payload
				if (entry.agentId) {
					const agent = dbGetAgent(entry.agentId)
					if (agent) {
						enriched = {
							agentRole: agent.role,
							...(agent.taskId ? { taskId: agent.taskId } : {}),
							...entry.payload,
						}
					}
				}
				const payloadStr = JSON.stringify(enriched)
				const result = tx
					.insert(activity)
					.values({
						teamId: entry.teamId,
						agentId: entry.agentId,
						type: entry.type,
						payload: payloadStr,
						createdAt: now,
					})
					.run() as unknown as { lastInsertRowid: number }
				items.push({
					id: Number(result.lastInsertRowid),
					teamId: entry.teamId,
					agentId: entry.agentId,
					type: entry.type,
					payload: payloadStr,
					createdAt: now,
				})
			}
		})

		// Broadcast after transaction commits
		for (const item of items) {
			for (const fn of listeners.get(item.teamId) ?? []) {
				safeCall('buffered listener', fn, item)
			}
		}
	}
}

const activityBuffer = new ActivityBuffer()

export function dbInsertActivityBuffered(
	teamId: string,
	agentId: string | null,
	type: string,
	payload: Record<string, unknown>,
): void {
	activityBuffer.enqueue(teamId, agentId, type, payload)
}

export function flushActivityBuffer(): void {
	activityBuffer.flushSync()
}

export function dbInsertPmReport(teamId: string, summary: string): void {
	getDb()
		.insert(pmReports)
		.values({ teamId, summary, createdAt: Date.now() })
		.run()
}
