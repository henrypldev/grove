import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import * as schema from './schema'

const DB_DIR = Bun.env.XDG_CONFIG_HOME
	? join(Bun.env.XDG_CONFIG_HOME, 'grove')
	: join(Bun.env.HOME ?? '', '.grove')

export const DB_PATH = join(DB_DIR, 'db.sqlite')

export type DrizzleDb = BunSQLiteDatabase<typeof schema>

let _db: DrizzleDb | null = null

export function getDb(): DrizzleDb {
	if (_db) return _db
	Bun.spawnSync(['mkdir', '-p', DB_DIR])
	const sqlite = new Database(DB_PATH, { create: true })
	sqlite.run('PRAGMA journal_mode = WAL')
	sqlite.run('PRAGMA foreign_keys = ON')
	seedMigrationsForExistingDb(sqlite)
	const db = drizzle(sqlite, { schema })
	migrate(db, { migrationsFolder: join(import.meta.dir, '../../drizzle') })
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
