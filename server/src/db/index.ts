import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
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
	runLegacyMigrations(sqlite)
	_db = drizzle(sqlite, { schema })
	return _db
}

export function _injectDb(db: DrizzleDb): void {
	_db = db
}

function runLegacyMigrations(db: Database) {
	db.run(`
    CREATE TABLE IF NOT EXISTS repos (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      github_url TEXT,
      env_vars TEXT,
      setup_steps TEXT,
      added_at INTEGER NOT NULL
    )
  `)

	db.run(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL REFERENCES repos(id),
      worktree_path TEXT NOT NULL,
      task TEXT NOT NULL,
      status TEXT NOT NULL,
      pm_summary TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

	db.run(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id),
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      current_task TEXT,
      session_id TEXT,
      retry_count INTEGER DEFAULT 0,
      spawned_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

	try {
		db.run('ALTER TABLE agents ADD COLUMN activity TEXT')
	} catch {}

	try {
		db.run('ALTER TABLE teams ADD COLUMN title TEXT')
	} catch {}

	try {
		db.run('ALTER TABLE teams ADD COLUMN port INTEGER')
	} catch {}

	try {
		db.run('ALTER TABLE teams RENAME COLUMN metro_port TO port')
	} catch {}

	db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL REFERENCES teams(id),
      agent_id TEXT REFERENCES agents(id),
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)

	try {
		const col = db
			.query<{ notnull: number }, [string]>(
				'SELECT "notnull" FROM pragma_table_info(\'events\') WHERE name = ?',
			)
			.get('agent_id')
		if (col && col.notnull === 1) {
			db.run('PRAGMA foreign_keys = OFF')
			db.run(`
        CREATE TABLE events_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          team_id TEXT NOT NULL REFERENCES teams(id),
          agent_id TEXT REFERENCES agents(id),
          type TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `)
			db.run('INSERT INTO events_new SELECT * FROM events')
			db.run('DROP TABLE events')
			db.run('ALTER TABLE events_new RENAME TO events')
			db.run('PRAGMA foreign_keys = ON')
		}
	} catch {}

	db.run(`
    CREATE INDEX IF NOT EXISTS idx_events_team_created
    ON events(team_id, created_at)
  `)

	db.run(`
    CREATE INDEX IF NOT EXISTS idx_events_agent_created
    ON events(agent_id, created_at)
  `)

	db.run(`
    CREATE TABLE IF NOT EXISTS pm_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL REFERENCES teams(id),
      summary TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)

	db.run(`
    CREATE TABLE IF NOT EXISTS usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL REFERENCES teams(id),
      agent_id TEXT REFERENCES agents(id),
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL,
      duration_ms INTEGER NOT NULL,
      duration_api_ms INTEGER NOT NULL,
      num_turns INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)

	db.run('CREATE INDEX IF NOT EXISTS idx_usage_created ON usage(created_at)')
	db.run(
		'CREATE INDEX IF NOT EXISTS idx_usage_team_created ON usage(team_id, created_at)',
	)

	db.run(`
    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL REFERENCES teams(id),
      type TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
}
