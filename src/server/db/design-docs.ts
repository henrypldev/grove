import { eq } from 'drizzle-orm'
import { getDb } from './index'
import { designDocs } from './schema'

export function dbUpsertDesignDoc(
	teamId: string,
	agentId: string,
	content: string,
): void {
	const db = getDb()
	const existing = db
		.select({ id: designDocs.id })
		.from(designDocs)
		.where(eq(designDocs.teamId, teamId))
		.limit(1)
		.get()
	if (existing) {
		db.update(designDocs)
			.set({ agentId, content, createdAt: Date.now() })
			.where(eq(designDocs.id, existing.id))
			.run()
	} else {
		db.insert(designDocs)
			.values({ teamId, agentId, content, createdAt: Date.now() })
			.run()
	}
}

export function dbGetDesignDoc(
	teamId: string,
): { content: string; agentId: string } | null {
	const row = getDb()
		.select({ content: designDocs.content, agentId: designDocs.agentId })
		.from(designDocs)
		.where(eq(designDocs.teamId, teamId))
		.limit(1)
		.get()
	return row ?? null
}
