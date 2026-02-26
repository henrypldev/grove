import { and, eq } from 'drizzle-orm'
import { getDb } from './index'
import { agentTasks } from './schema'

export function dbInsertTasks(
	teamId: string,
	tasks: { idString: string; title: string; priority: number }[],
): void {
	const db = getDb()
	const now = Date.now()
	for (const t of tasks) {
		db.insert(agentTasks)
			.values({
				teamId,
				idString: t.idString,
				title: t.title,
				priority: t.priority,
				status: 'pending',
				createdAt: now,
			})
			.run()
	}
}

export function dbListTasks(teamId: string) {
	return getDb()
		.select()
		.from(agentTasks)
		.where(eq(agentTasks.teamId, teamId))
		.all()
}

export function dbUpdateTask(
	teamId: string,
	idString: string,
	updates: { status?: string; agentId?: string; blockedBy?: string[] },
): void {
	const set: Record<string, unknown> = {}
	if (updates.status) set.status = updates.status
	if (updates.agentId) set.agentId = updates.agentId
	if (updates.blockedBy) set.blockedBy = JSON.stringify(updates.blockedBy)
	if (Object.keys(set).length === 0) return
	getDb()
		.update(agentTasks)
		.set(set)
		.where(
			and(eq(agentTasks.teamId, teamId), eq(agentTasks.idString, idString)),
		)
		.run()
}
