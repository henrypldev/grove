import { beforeEach, describe, expect, test } from 'bun:test'
import {
	dbGetActivitySinceId,
	dbGetLatestActivityId,
	dbInsertActivity,
	dbListActivitySince,
	emitEphemeralActivity,
	subscribeToTeamActivity,
} from '../activity'
import { dbInsertAgent } from '../agents'
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
	prUrl: null,
	title: null,
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

describe('db/activity', () => {
	beforeEach(() => {
		makeTestDb()
		dbInsertRepo(REPO)
		dbInsertTeam(TEAM)
		dbInsertAgent(AGENT)
	})

	test('getLatestActivityId returns 0 when empty', () => {
		expect(dbGetLatestActivityId()).toBe(0)
	})

	test('insertActivity returns item with numeric id', () => {
		const ev = dbInsertActivity('t1', 'a1', 'test:event', { foo: 'bar' })
		expect(typeof ev.id).toBe('number')
		expect(ev.teamId).toBe('t1')
		expect(ev.type).toBe('test:event')
		expect(JSON.parse(ev.payload)).toEqual({ foo: 'bar' })
	})

	test('getLatestActivityId after insert', () => {
		dbInsertActivity('t1', 'a1', 'e', {})
		const id = dbGetLatestActivityId()
		expect(id).toBeGreaterThan(0)
	})

	test('listActivitySince filters by time', async () => {
		dbInsertActivity('t1', 'a1', 'e1', {})
		await Bun.sleep(2)
		const mid = Date.now()
		await Bun.sleep(2)
		dbInsertActivity('t1', 'a1', 'e2', {})
		const items = dbListActivitySince('t1', mid)
		expect(items).toHaveLength(1)
		expect(items[0].type).toBe('e2')
	})

	test('getActivitySinceId returns only newer', () => {
		const e1 = dbInsertActivity('t1', 'a1', 'e1', {})
		dbInsertActivity('t1', 'a1', 'e2', {})
		const items = dbGetActivitySinceId(e1.id)
		expect(items).toHaveLength(1)
		expect(items[0].type).toBe('e2')
	})

	test('emitEphemeralActivity fires listeners without persisting', () => {
		const received: unknown[] = []
		const unsub = subscribeToTeamActivity('t1', ev => received.push(ev))

		emitEphemeralActivity('t1', 'a1', 'agent:status_change', {
			status: 'working',
			activity: 'reading files',
		})

		expect(received).toHaveLength(1)
		const ev = received[0] as { type: string; id: number }
		expect(ev.type).toBe('agent:status_change')
		expect(ev.id).toBe(-1)
		expect(dbListActivitySince('t1', 0)).toHaveLength(0)
		unsub()
	})

	test('listActivitySince filters by team', () => {
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
			prUrl: null,
			title: null,
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
		dbInsertActivity('t1', 'a1', 'for-t1', {})
		dbInsertActivity('t2', 'a2', 'for-t2', {})
		expect(dbListActivitySince('t1', 0)).toHaveLength(1)
		expect(dbListActivitySince('t2', 0)).toHaveLength(1)
	})
})
