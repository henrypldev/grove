import { beforeEach, describe, expect, test } from 'bun:test'
import {
	dbGetAgent,
	dbIncrementAgentRetry,
	dbInsertAgent,
	dbListAgentsByTeam,
	dbUpdateAgentActivity,
	dbUpdateAgentSessionId,
	dbUpdateAgentStatus,
} from '../agents'
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
	status: 'working' as const,
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
	currentTask: 'coding',
	sessionId: null,
	retryCount: 0,
	spawnedAt: 1000,
	updatedAt: 1000,
}

describe('db/agents', () => {
	beforeEach(() => {
		makeTestDb()
		dbInsertRepo(REPO)
		dbInsertTeam(TEAM)
	})

	test('list returns empty initially', () => {
		expect(dbListAgentsByTeam('t1')).toEqual([])
	})

	test('insert and get', () => {
		dbInsertAgent(AGENT)
		const got = dbGetAgent('a1')
		expect(got?.id).toBe('a1')
		expect(got?.role).toBe('dev')
		expect(got?.retryCount).toBe(0)
	})

	test('list by team', () => {
		dbInsertAgent(AGENT)
		expect(dbListAgentsByTeam('t1')).toHaveLength(1)
		expect(dbListAgentsByTeam('other')).toHaveLength(0)
	})

	test('updateStatus changes status', () => {
		dbInsertAgent(AGENT)
		dbUpdateAgentStatus('a1', 't1', 'done')
		expect(dbGetAgent('a1')?.status).toBe('done')
	})

	test('updateSessionId sets session', () => {
		dbInsertAgent(AGENT)
		dbUpdateAgentSessionId('a1', 'sess-123')
		expect(dbGetAgent('a1')?.sessionId).toBe('sess-123')
	})

	test('incrementRetry returns new count', () => {
		dbInsertAgent(AGENT)
		expect(dbIncrementAgentRetry('a1')).toBe(1)
		expect(dbIncrementAgentRetry('a1')).toBe(2)
		expect(dbGetAgent('a1')?.retryCount).toBe(2)
	})

	test('updateActivity sets and clears activity', () => {
		dbInsertAgent({ ...AGENT, activity: null })
		dbUpdateAgentActivity('a1', 't1', 'writing code')
		expect(dbGetAgent('a1')?.activity).toBe('writing code')
		dbUpdateAgentActivity('a1', 't1', null)
		expect(dbGetAgent('a1')?.activity).toBeNull()
	})

	test('get non-existent returns null', () => {
		expect(dbGetAgent('nope')).toBeNull()
	})
})
