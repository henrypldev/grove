import { and, eq, gte, inArray } from 'drizzle-orm'
import { getDb } from './index'
import { agents, teams, usage } from './schema'

export function dbInsertUsage(row: typeof usage.$inferInsert): void {
	getDb().insert(usage).values(row).run()
}

export type UsageRow = typeof usage.$inferSelect & { agentRole: string | null }

export function dbGetUsage(opts: {
	teamId?: string
	repoId?: string
	since: number
}): UsageRow[] {
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
		.select({
			id: usage.id,
			teamId: usage.teamId,
			agentId: usage.agentId,
			model: usage.model,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			cacheReadTokens: usage.cacheReadTokens,
			cacheCreationTokens: usage.cacheCreationTokens,
			costUsd: usage.costUsd,
			durationMs: usage.durationMs,
			durationApiMs: usage.durationApiMs,
			numTurns: usage.numTurns,
			createdAt: usage.createdAt,
			agentRole: agents.role,
		})
		.from(usage)
		.leftJoin(agents, eq(usage.agentId, agents.id))
		.where(and(...conditions))
		.all()
}
