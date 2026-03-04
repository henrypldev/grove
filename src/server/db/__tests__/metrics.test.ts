import { beforeEach, describe, expect, test } from 'bun:test'
import { dbInsertActivity } from '../activity'
import { dbInsertAgent } from '../agents'
import { dbGetMetrics } from '../metrics'
import { dbInsertRepo } from '../repos'
import { dbInsertTeam } from '../teams'
import { AGENT, makeTestDb, REPO, TEAM } from './helpers'

describe('db/metrics', () => {
	beforeEach(() => makeTestDb())

	test('returns zeros when empty', () => {
		const m = dbGetMetrics()
		expect(m.teamsCompleted).toBe(0)
		expect(m.agentsCompleted).toBe(0)
		expect(m.tasksCompleted).toBe(0)
		expect(m.eventCounts).toEqual({})
	})

	test('counts completed teams and agents', () => {
		dbInsertRepo(REPO)
		dbInsertTeam({ ...TEAM, status: 'done' })
		dbInsertTeam({ ...TEAM, id: 't2', status: 'archived' })
		dbInsertTeam({ ...TEAM, id: 't3', status: 'planning' })
		dbInsertAgent({ ...AGENT, status: 'done' })
		dbInsertAgent({ ...AGENT, id: 'a2', status: 'working' })
		const m = dbGetMetrics()
		expect(m.teamsCompleted).toBe(2)
		expect(m.agentsCompleted).toBe(1)
	})

	test('counts event types', () => {
		dbInsertRepo(REPO)
		dbInsertTeam({ ...TEAM, status: 'done' })
		dbInsertAgent({ ...AGENT, status: 'done' })
		dbInsertActivity('t1', 'a1', 'message', {})
		dbInsertActivity('t1', 'a1', 'message', {})
		dbInsertActivity('t1', 'a1', 'tool_use', {})
		const m = dbGetMetrics()
		expect(m.eventCounts.message).toBe(2)
		expect(m.eventCounts.tool_use).toBe(1)
	})
})
