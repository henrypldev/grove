import { beforeEach, describe, expect, test } from 'bun:test'
import { dbInsertRepo } from '../repos'
import {
	dbGetDependentTeams,
	dbGetTeamDependencies,
	dbInsertTeamDependency,
} from '../team-dependencies'
import { dbInsertTeam } from '../teams'
import { makeTestDb, REPO, TEAM } from './helpers'

describe('db/team-dependencies', () => {
	beforeEach(() => {
		makeTestDb()
		dbInsertRepo(REPO)
		dbInsertTeam({ ...TEAM, id: 't1' })
		dbInsertTeam({ ...TEAM, id: 't2' })
		dbInsertTeam({ ...TEAM, id: 't3' })
	})

	test('returns empty when no dependencies', () => {
		expect(dbGetTeamDependencies('t1')).toEqual([])
	})

	test('insert and get dependencies', () => {
		dbInsertTeamDependency('t1', 't2')
		const deps = dbGetTeamDependencies('t1')
		expect(deps).toHaveLength(1)
		expect(deps[0].dependsOnTeamId).toBe('t2')
	})

	test('get dependent teams (reverse lookup)', () => {
		dbInsertTeamDependency('t1', 't3')
		dbInsertTeamDependency('t2', 't3')
		const dependents = dbGetDependentTeams('t3')
		expect(dependents).toHaveLength(2)
	})

	test('multiple dependencies for one team', () => {
		dbInsertTeamDependency('t1', 't2')
		dbInsertTeamDependency('t1', 't3')
		expect(dbGetTeamDependencies('t1')).toHaveLength(2)
	})
})
