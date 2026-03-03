import { beforeEach, describe, expect, test } from 'bun:test'
import { dbInsertRepo } from '../repos'
import { dbInsertTeam } from '../teams'
import { dbInsertAgent } from '../agents'
import { dbGetNote, dbUpsertNote } from '../agent-notes'
import { AGENT, REPO, TEAM, makeTestDb } from './helpers'

describe('db/agent-notes', () => {
	beforeEach(() => {
		makeTestDb()
		dbInsertRepo(REPO)
		dbInsertTeam(TEAM)
		dbInsertAgent(AGENT)
	})

	test('get returns null when no note', () => {
		expect(dbGetNote('t1')).toBeNull()
	})

	test('upsert inserts and get retrieves', () => {
		dbUpsertNote('t1', 'a1', 'note content')
		const note = dbGetNote('t1')
		expect(note?.content).toBe('note content')
		expect(note?.agentId).toBe('a1')
	})

	test('upsert updates existing note', () => {
		dbUpsertNote('t1', 'a1', 'v1')
		dbUpsertNote('t1', 'a1', 'v2')
		const note = dbGetNote('t1')
		expect(note?.content).toBe('v2')
	})
})
