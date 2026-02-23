import { and, desc, eq } from 'drizzle-orm'
import { getDb } from './index'
import { plans } from './schema'

export function dbInsertPlan(
	teamId: string,
	agentId: string,
	type: string,
	content: string,
): void {
	getDb()
		.insert(plans)
		.values({ teamId, agentId, type, content, createdAt: Date.now() })
		.run()
}

export function dbGetPlan(
	teamId: string,
	type: string,
): { content: string; agentId: string } | null {
	const row = getDb()
		.select({ content: plans.content, agentId: plans.agentId })
		.from(plans)
		.where(and(eq(plans.teamId, teamId), eq(plans.type, type)))
		.orderBy(desc(plans.createdAt))
		.limit(1)
		.get()
	return row ?? null
}
