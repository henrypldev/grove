import { beforeEach, describe, expect, test } from 'bun:test'
import { dbInsertAgent } from '../agents'
import {
	dbGetEventsSinceId,
	dbGetLatestEventId,
	dbInsertEvent,
	dbListEventsSince,
	emitEphemeralEvent,
	subscribeToTeamEvents,
} from '../events'
import { dbInsertRepo } from '../repos'
import { dbInsertTeam } from '../teams'
import { makeTestDb } from './helpers'

const REPO = {
	id: 'r1',
	name: 'repo',
	path: '/tmp/repo',
	envVars: undefined,
	setupSteps: undefined,
}
const TEAM = {
	id: 't1',
	repoId: 'r1',
	worktreePath: '/tmp/wt',
	task: 'task',
	status: 'planning' as const,
	pmSummary: null,
	createdAt: 1000,
	updatedAt: 1000,
}
const AGENT = {
	id: 'a1',
	teamId: 't1',
	role: 'dev' as const,
	status: 'working' as const,
	activity: null,
	currentTask: null,
	sessionId: null,
	retryCount: 0,
	spawnedAt: 1000,
	updatedAt: 1000,
}

describe('db/events', () => {
	beforeEach(() => {
		makeTestDb()
		dbInsertRepo(REPO)
		dbInsertTeam(TEAM)
		dbInsertAgent(AGENT)
	})

	test('getLatestEventId returns 0 when empty', () => {
		expect(dbGetLatestEventId()).toBe(0)
	})

	test('insertEvent returns event with numeric id', () => {
		const ev = dbInsertEvent('t1', 'a1', 'test:event', { foo: 'bar' })
		expect(typeof ev.id).toBe('number')
		expect(ev.teamId).toBe('t1')
		expect(ev.type).toBe('test:event')
		expect(JSON.parse(ev.payload)).toEqual({ foo: 'bar' })
	})

	test('getLatestEventId after insert', () => {
		dbInsertEvent('t1', 'a1', 'e', {})
		const id = dbGetLatestEventId()
		expect(id).toBeGreaterThan(0)
	})

	test('listEventsSince filters by time', async () => {
		dbInsertEvent('t1', 'a1', 'e1', {})
		await Bun.sleep(2)
		const mid = Date.now()
		await Bun.sleep(2)
		dbInsertEvent('t1', 'a1', 'e2', {})
		const events = dbListEventsSince('t1', mid)
		expect(events).toHaveLength(1)
		expect(events[0].type).toBe('e2')
	})

	test('getEventsSinceId returns only newer', () => {
		const e1 = dbInsertEvent('t1', 'a1', 'e1', {})
		dbInsertEvent('t1', 'a1', 'e2', {})
		const events = dbGetEventsSinceId(e1.id)
		expect(events).toHaveLength(1)
		expect(events[0].type).toBe('e2')
	})

	test('emitEphemeralEvent fires listeners without persisting', () => {
		const received: unknown[] = []
		const unsub = subscribeToTeamEvents('t1', (ev) => received.push(ev))

		emitEphemeralEvent('t1', 'a1', 'agent:status_change', { status: 'working', activity: 'reading files' })

		expect(received).toHaveLength(1)
		const ev = received[0] as { type: string; id: number }
		expect(ev.type).toBe('agent:status_change')
		expect(ev.id).toBe(-1)
		expect(dbListEventsSince('t1', 0)).toHaveLength(0)
		unsub()
	})

	test('listEventsSince filters by team', () => {
		dbInsertRepo({
			id: 'r2',
			name: 'r2',
			path: '/r2',
			envVars: undefined,
			setupSteps: undefined,
		})
		dbInsertTeam({
			id: 't2',
			repoId: 'r2',
			worktreePath: '/wt2',
			task: 't',
			status: 'planning',
			pmSummary: null,
			createdAt: 1000,
			updatedAt: 1000,
		})
		dbInsertAgent({
			id: 'a2',
			teamId: 't2',
			role: 'dev',
			status: 'working',
			activity: null,
			currentTask: null,
			sessionId: null,
			retryCount: 0,
			spawnedAt: 1000,
			updatedAt: 1000,
		})
		dbInsertEvent('t1', 'a1', 'for-t1', {})
		dbInsertEvent('t2', 'a2', 'for-t2', {})
		expect(dbListEventsSince('t1', 0)).toHaveLength(1)
		expect(dbListEventsSince('t2', 0)).toHaveLength(1)
	})
})
