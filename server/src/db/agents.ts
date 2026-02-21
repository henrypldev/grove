import type { Agent, AgentRole, AgentStatus } from '../types'
import { getDb } from './index'

interface DbAgent {
	id: string
	team_id: string
	role: string
	status: string
	current_task: string | null
	session_id: string | null
	retry_count: number
	spawned_at: number
	updated_at: number
}

function toAgent(row: DbAgent): Agent {
	return {
		id: row.id,
		teamId: row.team_id,
		role: row.role as AgentRole,
		status: row.status as AgentStatus,
		currentTask: row.current_task,
		sessionId: row.session_id,
		retryCount: row.retry_count,
		spawnedAt: row.spawned_at,
		updatedAt: row.updated_at,
	}
}

export function dbListAgentsByTeam(teamId: string): Agent[] {
	const rows = getDb()
		.query<DbAgent, [string]>(
			'SELECT * FROM agents WHERE team_id = ? ORDER BY spawned_at ASC',
		)
		.all(teamId)
	return rows.map(toAgent)
}

export function dbGetAgentByTeamAndRole(teamId: string, role: AgentRole): Agent | null {
	const row = getDb()
		.query<DbAgent, [string, string]>(
			'SELECT * FROM agents WHERE team_id = ? AND role = ? ORDER BY spawned_at ASC LIMIT 1',
		)
		.get(teamId, role)
	return row ? toAgent(row) : null
}

export function dbGetAgent(id: string): Agent | null {
	const row = getDb()
		.query<DbAgent, [string]>('SELECT * FROM agents WHERE id = ?')
		.get(id)
	return row ? toAgent(row) : null
}

export function dbInsertAgent(agent: Agent): void {
	getDb().run(
		`INSERT INTO agents (id, team_id, role, status, current_task, session_id, retry_count, spawned_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			agent.id,
			agent.teamId,
			agent.role,
			agent.status,
			agent.currentTask,
			agent.sessionId,
			agent.retryCount,
			agent.spawnedAt,
			agent.updatedAt,
		],
	)
}

export function dbUpdateAgentStatus(
	id: string,
	status: AgentStatus,
	currentTask?: string | null,
): void {
	const now = Date.now()
	getDb().run(
		'UPDATE agents SET status = ?, current_task = ?, updated_at = ? WHERE id = ?',
		[status, currentTask ?? null, now, id],
	)
}

export function dbUpdateAgentSessionId(id: string, sessionId: string): void {
	getDb().run('UPDATE agents SET session_id = ?, updated_at = ? WHERE id = ?', [
		sessionId,
		Date.now(),
		id,
	])
}

export function dbIncrementAgentRetry(id: string): number {
	getDb().run(
		'UPDATE agents SET retry_count = retry_count + 1, updated_at = ? WHERE id = ?',
		[Date.now(), id],
	)
	const row = getDb()
		.query<{ retry_count: number }, [string]>(
			'SELECT retry_count FROM agents WHERE id = ?',
		)
		.get(id)
	return row?.retry_count ?? 0
}
