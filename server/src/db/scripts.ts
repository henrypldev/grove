import { eq } from 'drizzle-orm'
import type { Script } from '../types'
import { getDb } from './index'
import { scripts } from './schema'

export function dbListScriptsByRepo(repoId: string): Script[] {
	const rows = getDb()
		.select()
		.from(scripts)
		.where(eq(scripts.repoId, repoId))
		.orderBy(scripts.createdAt)
		.all()
	return rows.map(toScript)
}

export function dbGetScript(id: string): Script | null {
	const row = getDb().select().from(scripts).where(eq(scripts.id, id)).get()
	return row ? toScript(row) : null
}

export function dbInsertScript(script: Script): void {
	getDb()
		.insert(scripts)
		.values({
			id: script.id,
			repoId: script.repoId,
			name: script.name,
			run: script.run,
			background: script.background ? 1 : null,
			createdAt: script.createdAt,
		})
		.run()
}

export function dbUpdateScript(
	id: string,
	data: { name?: string; run?: string; background?: boolean },
): boolean {
	const set: Record<string, unknown> = {}
	if (data.name !== undefined) set.name = data.name
	if (data.run !== undefined) set.run = data.run
	if (data.background !== undefined) set.background = data.background ? 1 : null
	const result = getDb()
		.update(scripts)
		.set(set)
		.where(eq(scripts.id, id))
		.run() as unknown as { changes: number }
	return result.changes > 0
}

export function dbDeleteScript(id: string): boolean {
	const result = getDb()
		.delete(scripts)
		.where(eq(scripts.id, id))
		.run() as unknown as { changes: number }
	return result.changes > 0
}

function toScript(row: typeof scripts.$inferSelect): Script {
	return {
		id: row.id,
		repoId: row.repoId,
		name: row.name,
		run: row.run,
		background: row.background ? true : undefined,
		createdAt: row.createdAt,
	}
}
