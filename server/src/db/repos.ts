import { eq } from 'drizzle-orm'
import type { Repo } from '../types'
import { getDb } from './index'
import { repos } from './schema'

export function dbListRepos(): Repo[] {
	const rows = getDb().select().from(repos).orderBy(repos.addedAt).all()
	return rows.map(toRepo)
}

export function dbGetRepo(id: string): Repo | null {
	const row = getDb().select().from(repos).where(eq(repos.id, id)).get()
	return row ? toRepo(row) : null
}

export function dbInsertRepo(repo: Repo): void {
	getDb()
		.insert(repos)
		.values({
			id: repo.id,
			name: repo.name,
			path: repo.path,
			envVars: repo.envVars ? JSON.stringify(repo.envVars) : null,
			setupSteps: repo.setupSteps ? JSON.stringify(repo.setupSteps) : null,
			addedAt: Date.now(),
		})
		.run()
}

export function dbDeleteRepo(id: string): boolean {
	const result = getDb()
		.delete(repos)
		.where(eq(repos.id, id))
		.run() as unknown as { changes: number }
	return result.changes > 0
}

export function dbUpdateRepoSetupSteps(
	id: string,
	setupSteps: Repo['setupSteps'],
): boolean {
	const result = getDb()
		.update(repos)
		.set({ setupSteps: setupSteps ? JSON.stringify(setupSteps) : null })
		.where(eq(repos.id, id))
		.run() as unknown as { changes: number }
	return result.changes > 0
}

function toRepo(row: typeof repos.$inferSelect): Repo {
	return {
		id: row.id,
		name: row.name,
		path: row.path,
		envVars: row.envVars ? JSON.parse(row.envVars) : undefined,
		setupSteps: row.setupSteps ? JSON.parse(row.setupSteps) : undefined,
	}
}
