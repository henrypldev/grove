import { Database } from 'bun:sqlite'
import { _injectDb, initSchema } from '../index'

export function makeTestDb(): Database {
	const db = new Database(':memory:')
	db.run('PRAGMA journal_mode = WAL')
	db.run('PRAGMA foreign_keys = ON')
	initSchema(db)
	_injectDb(db)
	return db
}
