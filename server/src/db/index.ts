import { Database } from 'bun:sqlite'
import { join } from 'node:path'

const DB_DIR = Bun.env.XDG_CONFIG_HOME
	? join(Bun.env.XDG_CONFIG_HOME, 'grove')
	: join(Bun.env.HOME ?? '', '.grove')

export const DB_PATH = join(DB_DIR, 'db.sqlite')

let _db: Database | null = null

export function getDb(): Database {
	if (_db) return _db
	Bun.spawnSync(['mkdir', '-p', DB_DIR])
	_db = new Database(DB_PATH, { create: true })
	_db.run('PRAGMA journal_mode = WAL')
	_db.run('PRAGMA foreign_keys = ON')
	initSchema(_db)
	return _db
}

export function _injectDb(db: Database): void {
	_db = db
}

export function initSchema(db: Database) {
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

	db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL REFERENCES teams(id),
      agent_id TEXT NOT NULL REFERENCES agents(id),
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)

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
}
