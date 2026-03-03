import { and, eq, gte, inArray } from 'drizzle-orm'
import { getDb } from './index'
import { teams, usage } from './schema'

export function dbInsertUsage(row: typeof usage.$inferInsert): void {
	getDb().insert(usage).values(row).run()
}

export function dbGetUsage(opts: {
	teamId?: string
	repoId?: string
	since: number
}): (typeof usage.$inferSelect)[] {
	const conditions = [gte(usage.createdAt, opts.since)]
	if (opts.teamId) {
		conditions.push(eq(usage.teamId, opts.teamId))
	}
	if (opts.repoId) {
		const teamIds = getDb()
			.select({ id: teams.id })
			.from(teams)
			.where(eq(teams.repoId, opts.repoId))
			.all()
			.map(t => t.id)
		if (teamIds.length === 0) return []
		conditions.push(inArray(usage.teamId, teamIds))
	}
	return getDb()
		.select()
		.from(usage)
		.where(and(...conditions))
		.all()
}
