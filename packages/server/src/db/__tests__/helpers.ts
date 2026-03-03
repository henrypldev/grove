import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { _injectDb } from '../index'
import * as schema from '../schema'

export function makeTestDb() {
	const sqlite = new Database(':memory:')
	sqlite.run('PRAGMA journal_mode = WAL')
	sqlite.run('PRAGMA foreign_keys = ON')

	const db = drizzle(sqlite, { schema })
	migrate(db, { migrationsFolder: join(import.meta.dir, '../../../drizzle') })

	// Migration 0008 uses ALTER TABLE RENAME which doesn't work reliably
	// with Drizzle's in-memory SQLite migrator. Fix it manually.
	const tables = sqlite.query("SELECT name FROM sqlite_master WHERE type='table' AND name='events'").all()
	if (tables.length > 0) {
		sqlite.run('ALTER TABLE `events` RENAME TO `activity`')
	}

	_injectDb(db)
	return db
}

export const REPO = { id: 'r1', name: 'repo', path: '/tmp/repo', envVars: undefined, setupSteps: undefined }
export const TEAM = { id: 't1', repoId: 'r1', worktreePath: '/tmp/wt', task: 'task', status: 'planning' as const, pmSummary: null, port: null, title: null, createdAt: 1000, updatedAt: 1000 }
export const AGENT = { id: 'a1', teamId: 't1', role: 'dev' as const, status: 'working' as const, activity: null, currentTask: null, sessionId: null, retryCount: 0, spawnedAt: 1000, updatedAt: 1000 }
