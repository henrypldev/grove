import { getDb } from './index'

export function dbInsertPlan(
	teamId: string,
	agentId: string,
	type: string,
	content: string,
): void {
	getDb().run(
		'INSERT INTO plans (team_id, agent_id, type, content, created_at) VALUES (?, ?, ?, ?, ?)',
		[teamId, agentId, type, content, Date.now()],
	)
}

export function dbGetPlan(
	teamId: string,
	type: string,
): { content: string; agentId: string } | null {
	const row = getDb()
		.query<
			{ content: string; agent_id: string },
			[string, string]
		>(
			'SELECT content, agent_id as agent_id FROM plans WHERE team_id = ? AND type = ? ORDER BY created_at DESC LIMIT 1',
		)
		.get(teamId, type)
	return row ? { content: row.content, agentId: row.agent_id } : null
}
