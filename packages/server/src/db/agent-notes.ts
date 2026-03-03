import { eq } from 'drizzle-orm'
import { getDb } from './index'
import { agentNotes } from './schema'

export function dbUpsertNote(
	teamId: string,
	agentId: string,
	content: string,
): void {
	const db = getDb()
	const existing = db
		.select({ id: agentNotes.id })
		.from(agentNotes)
		.where(eq(agentNotes.teamId, teamId))
		.limit(1)
		.get()
	if (existing) {
		db.update(agentNotes)
			.set({ agentId, content, createdAt: Date.now() })
			.where(eq(agentNotes.id, existing.id))
			.run()
	} else {
		db.insert(agentNotes)
			.values({ teamId, agentId, content, createdAt: Date.now() })
			.run()
	}
}

export function dbGetNote(
	teamId: string,
): { content: string; agentId: string } | null {
	const row = getDb()
		.select({ content: agentNotes.content, agentId: agentNotes.agentId })
		.from(agentNotes)
		.where(eq(agentNotes.teamId, teamId))
		.limit(1)
		.get()
	return row ?? null
}
