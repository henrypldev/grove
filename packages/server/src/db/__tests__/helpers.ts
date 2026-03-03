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
	_injectDb(db)
	return db
}
