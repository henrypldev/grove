import { beforeEach, describe, expect, test } from 'bun:test'
import { dbInsertRepo } from '../repos'
import {
	dbArchiveTeam,
	dbGetTeam,
	dbInsertTeam,
	dbListTeams,
	dbListTeamsByRepo,
	dbUpdateTeamStatus,
} from '../teams'
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
	worktreePath: '/tmp/wt1',
	task: 'do something',
	status: 'planning' as const,
	pmSummary: null,
	createdAt: 1000,
	updatedAt: 1000,
}

describe('db/teams', () => {
	beforeEach(() => {
		makeTestDb()
		dbInsertRepo(REPO)
	})

	test('list returns empty initially', () => {
		expect(dbListTeams()).toEqual([])
	})

	test('insert and get', () => {
		dbInsertTeam(TEAM)
		const got = dbGetTeam('t1')
		expect(got?.id).toBe('t1')
		expect(got?.task).toBe('do something')
		expect(got?.status).toBe('planning')
	})

	test('list excludes archived', () => {
		dbInsertTeam(TEAM)
		dbArchiveTeam('t1')
		expect(dbListTeams()).toHaveLength(0)
	})

	test('listByRepo filters correctly', () => {
		dbInsertRepo({
			id: 'r2',
			name: 'r2',
			path: '/tmp/r2',
			envVars: undefined,
			setupSteps: undefined,
		})
		dbInsertTeam(TEAM)
		dbInsertTeam({ ...TEAM, id: 't2', repoId: 'r2' })
		expect(dbListTeamsByRepo('r1')).toHaveLength(1)
		expect(dbListTeamsByRepo('r2')).toHaveLength(1)
	})

	test('updateTeamStatus changes status', () => {
		dbInsertTeam(TEAM)
		dbUpdateTeamStatus('t1', 'active')
		expect(dbGetTeam('t1')?.status).toBe('active')
	})

	test('updateTeamStatus with pmSummary', () => {
		dbInsertTeam(TEAM)
		dbUpdateTeamStatus('t1', 'active', 'plan done')
		const got = dbGetTeam('t1')
		expect(got?.status).toBe('active')
		expect(got?.pmSummary).toBe('plan done')
	})

	test('get non-existent returns null', () => {
		expect(dbGetTeam('nope')).toBeNull()
	})
})
