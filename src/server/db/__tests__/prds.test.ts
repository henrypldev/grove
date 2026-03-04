import { beforeEach, describe, expect, test } from 'bun:test'
import { dbInsertAgent } from '../agents'
import { dbGetPrd, dbUpsertPrd } from '../prds'
import { dbInsertRepo } from '../repos'
import { dbInsertTeam } from '../teams'
import { AGENT, makeTestDb, REPO, TEAM } from './helpers'

describe('db/prds', () => {
	beforeEach(() => {
		makeTestDb()
		dbInsertRepo(REPO)
		dbInsertTeam(TEAM)
		dbInsertAgent(AGENT)
	})

	test('get returns null when no prd', () => {
		expect(dbGetPrd('t1')).toBeNull()
	})

	test('upsert inserts and get retrieves', () => {
		dbUpsertPrd('t1', 'a1', 'initial content')
		const prd = dbGetPrd('t1')
		expect(prd?.content).toBe('initial content')
		expect(prd?.agentId).toBe('a1')
	})

	test('upsert updates existing prd', () => {
		dbUpsertPrd('t1', 'a1', 'v1')
		dbUpsertPrd('t1', 'a1', 'v2')
		const prd = dbGetPrd('t1')
		expect(prd?.content).toBe('v2')
	})
})
