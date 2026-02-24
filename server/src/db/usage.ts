import { and, eq, gte } from 'drizzle-orm'
import { getDb } from './index'
import { usage } from './schema'

export function dbInsertUsage(row: typeof usage.$inferInsert): void {
	getDb().insert(usage).values(row).run()
}

export function dbGetUsage(opts: {
	teamId?: string
	since: number
}): (typeof usage.$inferSelect)[] {
	const conditions = [gte(usage.createdAt, opts.since)]
	if (opts.teamId) {
		conditions.push(eq(usage.teamId, opts.teamId))
	}
	return getDb()
		.select()
		.from(usage)
		.where(and(...conditions))
		.all()
}
