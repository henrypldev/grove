import type { Repo } from '../types'
import { getDb } from './index'

interface DbRepo {
	id: string
	name: string
	path: string
	github_url: string | null
	env_vars: string | null
	setup_steps: string | null
	added_at: number
}

function toRepo(row: DbRepo): Repo {
	return {
		id: row.id,
		name: row.name,
		path: row.path,
		envVars: row.env_vars ? JSON.parse(row.env_vars) : undefined,
		setupSteps: row.setup_steps ? JSON.parse(row.setup_steps) : undefined,
	}
}

export function dbListRepos(): Repo[] {
	const rows = getDb().query<DbRepo, []>('SELECT * FROM repos ORDER BY added_at ASC').all()
	return rows.map(toRepo)
}

export function dbGetRepo(id: string): Repo | null {
	const row = getDb().query<DbRepo, [string]>('SELECT * FROM repos WHERE id = ?').get(id)
	return row ? toRepo(row) : null
}

export function dbInsertRepo(repo: Repo): void {
	getDb().run(
		`INSERT INTO repos (id, name, path, github_url, env_vars, setup_steps, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
		[
			repo.id,
			repo.name,
			repo.path,
			null,
			repo.envVars ? JSON.stringify(repo.envVars) : null,
			repo.setupSteps ? JSON.stringify(repo.setupSteps) : null,
			Date.now(),
		],
	)
}

export function dbDeleteRepo(id: string): boolean {
	const result = getDb().run('DELETE FROM repos WHERE id = ?', [id])
	return result.changes > 0
}
