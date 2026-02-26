import { eq, sql } from 'drizzle-orm'
import { getDb } from './index'
import { agents, agentTasks, events, teams } from './schema'

export function dbGetMetrics() {
	const db = getDb()

	const teamsCompleted =
		db
			.select({ count: sql<number>`count(*)` })
			.from(teams)
			.where(sql`${teams.status} IN ('done', 'archived')`)
			.get()?.count ?? 0

	const agentsCompleted =
		db
			.select({ count: sql<number>`count(*)` })
			.from(agents)
			.where(eq(agents.status, 'done'))
			.get()?.count ?? 0

	const tasksCompleted =
		db
			.select({ count: sql<number>`count(*)` })
			.from(agentTasks)
			.where(eq(agentTasks.status, 'completed'))
			.get()?.count ?? 0

	const eventRows = db
		.select({
			type: events.type,
			count: sql<number>`count(*)`,
		})
		.from(events)
		.groupBy(events.type)
		.all()

	const eventCounts: Record<string, number> = {}
	for (const row of eventRows) {
		eventCounts[row.type] = row.count
	}

	return { teamsCompleted, agentsCompleted, tasksCompleted, eventCounts }
}
