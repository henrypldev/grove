import { beforeEach, describe, expect, test } from 'bun:test'
import { dbInsertRepo } from '../repos'
import { dbInsertTeam } from '../teams'
import { dbInsertAgent } from '../agents'
import { dbGetDesignDoc, dbUpsertDesignDoc } from '../design-docs'
import { AGENT, REPO, TEAM, makeTestDb } from './helpers'

describe('db/design-docs', () => {
	beforeEach(() => {
		makeTestDb()
		dbInsertRepo(REPO)
		dbInsertTeam(TEAM)
		dbInsertAgent(AGENT)
	})

	test('get returns null when no doc', () => {
		expect(dbGetDesignDoc('t1')).toBeNull()
	})

	test('upsert inserts and get retrieves', () => {
		dbUpsertDesignDoc('t1', 'a1', 'design content')
		const doc = dbGetDesignDoc('t1')
		expect(doc?.content).toBe('design content')
		expect(doc?.agentId).toBe('a1')
	})

	test('upsert updates existing doc', () => {
		dbUpsertDesignDoc('t1', 'a1', 'v1')
		dbUpsertDesignDoc('t1', 'a1', 'v2')
		const doc = dbGetDesignDoc('t1')
		expect(doc?.content).toBe('v2')
	})
})
