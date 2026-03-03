import { eq, sql } from 'drizzle-orm'
import { getDb } from './index'
import { activity, agents, agentTasks, teams } from './schema'

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
			.where(eq(agentTasks.status, 'complete'))
			.get()?.count ?? 0

	const eventRows = db
		.select({
			type: activity.type,
			count: sql<number>`count(*)`,
		})
		.from(activity)
		.groupBy(activity.type)
		.all()

	const eventCounts: Record<string, number> = {}
	for (const row of eventRows) {
		eventCounts[row.type] = row.count
	}

	return { teamsCompleted, agentsCompleted, tasksCompleted, eventCounts }
}
