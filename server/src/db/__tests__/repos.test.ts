import { beforeEach, describe, expect, test } from 'bun:test'
import { dbDeleteRepo, dbGetRepo, dbInsertRepo, dbListRepos } from '../repos'
import { makeTestDb } from './helpers'

const REPO = {
	id: 'r1',
	name: 'my-repo',
	path: '/tmp/my-repo',
	envVars: undefined,
	setupSteps: undefined,
}

describe('db/repos', () => {
	beforeEach(() => makeTestDb())

	test('list returns empty initially', () => {
		expect(dbListRepos()).toEqual([])
	})

	test('insert and get', () => {
		dbInsertRepo(REPO)
		const got = dbGetRepo('r1')
		expect(got?.id).toBe('r1')
		expect(got?.name).toBe('my-repo')
		expect(got?.path).toBe('/tmp/my-repo')
	})

	test('list after insert', () => {
		dbInsertRepo(REPO)
		expect(dbListRepos()).toHaveLength(1)
	})

	test('delete returns true and removes record', () => {
		dbInsertRepo(REPO)
		expect(dbDeleteRepo('r1')).toBe(true)
		expect(dbGetRepo('r1')).toBeNull()
	})

	test('delete non-existent returns false', () => {
		expect(dbDeleteRepo('nope')).toBe(false)
	})

	test('get non-existent returns null', () => {
		expect(dbGetRepo('nope')).toBeNull()
	})

	test('insert with envVars round-trips', () => {
		dbInsertRepo({ ...REPO, id: 'r2', envVars: { FOO: 'bar' } })
		const got = dbGetRepo('r2')
		expect(got?.envVars).toEqual({ FOO: 'bar' })
	})
})
