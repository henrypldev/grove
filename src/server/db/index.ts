import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { GROVE_DIR } from '../config'
import { migrations } from './migrations'
import * as schema from './schema'

export const DB_FILES = {
	production: 'db.sqlite',
	development: 'dev.sqlite',
	test: 'test.sqlite',
} as const

function getDbFilename(): string {
	const env = Bun.env.NODE_ENV ?? 'production'
	return DB_FILES[env as keyof typeof DB_FILES] ?? DB_FILES.production
}

export const DB_PATH = join(GROVE_DIR, getDbFilename())

export type DrizzleDb = BunSQLiteDatabase<typeof schema>

let _db: DrizzleDb | null = null

export function getDb(): DrizzleDb {
	if (_db) return _db
	Bun.spawnSync(['mkdir', '-p', GROVE_DIR])
	const sqlite = new Database(DB_PATH, { create: true })
	sqlite.run('PRAGMA journal_mode = WAL')
	sqlite.run('PRAGMA foreign_keys = ON')
	seedMigrationsForExistingDb(sqlite)
	const db = drizzle(sqlite, { schema })
	db.dialect.migrate(migrations, db.session, {})
	_db = db
	return _db
}

export function _injectDb(db: DrizzleDb): void {
	_db = db
}

function seedMigrationsForExistingDb(db: Database) {
	const hasRepos = db
		.query<{ n: number }, []>(
			"SELECT count(*) as n FROM sqlite_master WHERE type='table' AND name='repos'",
		)
		.get()
	if (!hasRepos || hasRepos.n === 0) return

	const hasJournal = db
		.query<{ n: number }, []>(
			"SELECT count(*) as n FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
		)
		.get()
	if (hasJournal && hasJournal.n > 0) return

	db.run(`
		CREATE TABLE IF NOT EXISTS __drizzle_migrations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			hash TEXT NOT NULL,
			created_at INTEGER
		)
	`)
	db.run(
		"INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('0000_numerous_morlun', 1771947066054)",
	)
}
