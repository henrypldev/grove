import { Database } from 'bun:sqlite'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { GROVE_DIR } from '../../config'
import { _injectDb, DB_FILES } from '../index'
import { migrations } from '../migrations'
import * as schema from '../schema'

const TEST_DB_PATH = join(GROVE_DIR, DB_FILES.test)

export function makeTestDb() {
	// Delete existing test db to start fresh
	for (const path of [
		TEST_DB_PATH,
		`${TEST_DB_PATH}-wal`,
		`${TEST_DB_PATH}-shm`,
	]) {
		rmSync(path, { force: true })
	}

	mkdirSync(GROVE_DIR, { recursive: true })
	const sqlite = new Database(TEST_DB_PATH, { create: true })
	sqlite.run('PRAGMA journal_mode = WAL')
	sqlite.run('PRAGMA foreign_keys = ON')

	const db = drizzle(sqlite, { schema })
	db.dialect.migrate(migrations, db.session, {})

	_injectDb(db)
	return db
}

export const REPO = {
	id: 'r1',
	name: 'repo',
	path: '/tmp/repo',
	envVars: undefined,
	setupSteps: undefined,
}
export const TEAM = {
	id: 't1',
	repoId: 'r1',
	worktreePath: '/tmp/wt',
	task: 'task',
	status: 'planning' as const,
	pmSummary: null,
	prUrl: null,
	title: null,
	createdAt: 1000,
	updatedAt: 1000,
}
export const AGENT = {
	id: 'a1',
	teamId: 't1',
	role: 'dev' as const,
	status: 'working' as const,
	activity: null,
	currentTask: null,
	sessionId: null,
	retryCount: 0,
	spawnedAt: 1000,
	updatedAt: 1000,
}
