import { beforeEach, describe, expect, test } from 'bun:test'
import { dbInsertRepo } from '../repos'
import {
	dbDeleteScript,
	dbGetScript,
	dbInsertScript,
	dbListScriptsByRepo,
	dbUpdateScript,
} from '../scripts'
import { makeTestDb, REPO } from './helpers'

const SCRIPT = {
	id: 's1',
	repoId: 'r1',
	name: 'dev',
	run: 'bun run dev',
	background: undefined,
	createdAt: 1000,
}

describe('db/scripts', () => {
	beforeEach(() => {
		makeTestDb()
		dbInsertRepo(REPO)
	})

	test('list returns empty initially', () => {
		expect(dbListScriptsByRepo('r1')).toEqual([])
	})

	test('insert and get', () => {
		dbInsertScript(SCRIPT)
		const got = dbGetScript('s1')
		expect(got?.name).toBe('dev')
		expect(got?.run).toBe('bun run dev')
	})

	test('list by repo', () => {
		dbInsertScript(SCRIPT)
		dbInsertScript({ ...SCRIPT, id: 's2', name: 'test', run: 'bun test' })
		expect(dbListScriptsByRepo('r1')).toHaveLength(2)
	})

	test('background boolean serialization', () => {
		dbInsertScript({ ...SCRIPT, id: 's3', background: true })
		const got = dbGetScript('s3')
		expect(got?.background).toBe(true)
	})

	test('update script', () => {
		dbInsertScript(SCRIPT)
		expect(dbUpdateScript('s1', { name: 'develop' })).toBe(true)
		expect(dbGetScript('s1')?.name).toBe('develop')
	})

	test('update non-existent returns false', () => {
		expect(dbUpdateScript('nope', { name: 'x' })).toBe(false)
	})

	test('delete script', () => {
		dbInsertScript(SCRIPT)
		expect(dbDeleteScript('s1')).toBe(true)
		expect(dbGetScript('s1')).toBeNull()
	})

	test('delete non-existent returns false', () => {
		expect(dbDeleteScript('nope')).toBe(false)
	})

	test('get non-existent returns null', () => {
		expect(dbGetScript('nope')).toBeNull()
	})
})
