import { eq } from 'drizzle-orm'
import { getDb } from './index'
import { prds } from './schema'

export function dbUpsertPrd(
	teamId: string,
	agentId: string,
	content: string,
): void {
	const db = getDb()
	const existing = db
		.select({ id: prds.id })
		.from(prds)
		.where(eq(prds.teamId, teamId))
		.limit(1)
		.get()
	if (existing) {
		db.update(prds)
			.set({ agentId, content, createdAt: Date.now() })
			.where(eq(prds.id, existing.id))
			.run()
	} else {
		db.insert(prds)
			.values({ teamId, agentId, content, createdAt: Date.now() })
			.run()
	}
}

export function dbGetPrd(
	teamId: string,
): { content: string; agentId: string } | null {
	const row = getDb()
		.select({ content: prds.content, agentId: prds.agentId })
		.from(prds)
		.where(eq(prds.teamId, teamId))
		.limit(1)
		.get()
	return row ?? null
}
