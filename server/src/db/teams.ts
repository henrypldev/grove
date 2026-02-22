import type { Team, TeamStatus } from '../types'
import { getDb } from './index'

interface DbTeam {
	id: string
	repo_id: string
	worktree_path: string
	task: string
	title: string | null
	status: string
	pm_summary: string | null
	created_at: number
	updated_at: number
}

function toTeam(row: DbTeam): Team {
	return {
		id: row.id,
		repoId: row.repo_id,
		worktreePath: row.worktree_path,
		task: row.task,
		title: row.title,
		status: row.status as TeamStatus,
		pmSummary: row.pm_summary,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	}
}

export function dbListTeams(): Team[] {
	const rows = getDb()
		.query<DbTeam, []>(
			"SELECT * FROM teams WHERE status != 'archived' ORDER BY created_at DESC",
		)
		.all()
	return rows.map(toTeam)
}

export function dbListTeamsByRepo(repoId: string): Team[] {
	const rows = getDb()
		.query<DbTeam, [string]>(
			"SELECT * FROM teams WHERE repo_id = ? AND status != 'archived' ORDER BY created_at DESC",
		)
		.all(repoId)
	return rows.map(toTeam)
}

export function dbGetTeam(id: string): Team | null {
	const row = getDb()
		.query<DbTeam, [string]>('SELECT * FROM teams WHERE id = ?')
		.get(id)
	return row ? toTeam(row) : null
}

export function dbInsertTeam(team: Team): void {
	getDb().run(
		`INSERT INTO teams (id, repo_id, worktree_path, task, title, status, pm_summary, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			team.id,
			team.repoId,
			team.worktreePath,
			team.task,
			team.title,
			team.status,
			team.pmSummary,
			team.createdAt,
			team.updatedAt,
		],
	)
}

export function dbUpdateTeamTitle(id: string, title: string): void {
	getDb().run('UPDATE teams SET title = ?, updated_at = ? WHERE id = ?', [
		title,
		Date.now(),
		id,
	])
}

export function dbUpdateTeamStatus(
	id: string,
	status: TeamStatus,
	pmSummary?: string,
): void {
	const now = Date.now()
	if (pmSummary !== undefined) {
		getDb().run(
			'UPDATE teams SET status = ?, pm_summary = ?, updated_at = ? WHERE id = ?',
			[status, pmSummary, now, id],
		)
	} else {
		getDb().run('UPDATE teams SET status = ?, updated_at = ? WHERE id = ?', [
			status,
			now,
			id,
		])
	}
}

export function dbArchiveTeam(id: string): void {
	dbUpdateTeamStatus(id, 'archived')
}
