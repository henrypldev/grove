import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { _injectDb } from '../index'
import * as schema from '../schema'

export function makeTestDb() {
	const sqlite = new Database(':memory:')
	sqlite.run('PRAGMA journal_mode = WAL')
	sqlite.run('PRAGMA foreign_keys = ON')

	sqlite.run(`
    CREATE TABLE repos (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      github_url TEXT,
      env_vars TEXT,
      setup_steps TEXT,
      added_at INTEGER NOT NULL
    )
  `)
	sqlite.run(`
    CREATE TABLE teams (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL REFERENCES repos(id),
      worktree_path TEXT NOT NULL,
      task TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL,
      pm_summary TEXT,
      port INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
	sqlite.run(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id),
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      activity TEXT,
      current_task TEXT,
      session_id TEXT,
      retry_count INTEGER DEFAULT 0,
      spawned_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
	sqlite.run(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL REFERENCES teams(id),
      agent_id TEXT REFERENCES agents(id),
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
	sqlite.run(`
    CREATE TABLE pm_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL REFERENCES teams(id),
      summary TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
	sqlite.run(`
    CREATE TABLE plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL REFERENCES teams(id),
      type TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)

	const db = drizzle(sqlite, { schema })
	_injectDb(db)
	return db
}
