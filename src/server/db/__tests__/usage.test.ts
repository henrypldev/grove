import { beforeEach, describe, expect, test } from 'bun:test'
import { dbInsertRepo } from '../repos'
import { dbInsertTeam } from '../teams'
import { dbGetUsage, dbInsertUsage } from '../usage'
import { makeTestDb, REPO, TEAM } from './helpers'

const USAGE_ROW = {
	teamId: 't1',
	model: 'claude-sonnet',
	inputTokens: 100,
	outputTokens: 50,
	costUsd: 0.01,
	durationMs: 500,
	durationApiMs: 400,
	numTurns: 1,
	createdAt: 2000,
}

describe('db/usage', () => {
	beforeEach(() => {
		makeTestDb()
		dbInsertRepo(REPO)
		dbInsertTeam(TEAM)
	})

	test('returns empty when no usage', () => {
		expect(dbGetUsage({ since: 0 })).toEqual([])
	})

	test('insert and get by teamId', () => {
		dbInsertUsage(USAGE_ROW)
		const rows = dbGetUsage({ teamId: 't1', since: 0 })
		expect(rows).toHaveLength(1)
		expect(rows[0].model).toBe('claude-sonnet')
	})

	test('filters by since', () => {
		dbInsertUsage({ ...USAGE_ROW, createdAt: 1000 })
		dbInsertUsage({ ...USAGE_ROW, createdAt: 3000 })
		const rows = dbGetUsage({ since: 2000 })
		expect(rows).toHaveLength(1)
	})

	test('filters by repoId via team lookup', () => {
		dbInsertRepo({
			id: 'r2',
			name: 'r2',
			path: '/r2',
			envVars: undefined,
			setupSteps: undefined,
		})
		dbInsertTeam({ ...TEAM, id: 't2', repoId: 'r2' })
		dbInsertUsage({ ...USAGE_ROW, teamId: 't2', createdAt: 2000 })
		dbInsertUsage({ ...USAGE_ROW, createdAt: 2000 })
		const rows = dbGetUsage({ repoId: 'r2', since: 0 })
		expect(rows).toHaveLength(1)
		expect(rows[0].teamId).toBe('t2')
	})

	test('repoId with no teams returns empty', () => {
		expect(dbGetUsage({ repoId: 'nonexistent', since: 0 })).toEqual([])
	})
})
