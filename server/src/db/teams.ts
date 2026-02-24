import { and, desc, eq, ne } from 'drizzle-orm'
import type { Team, TeamStatus } from '../types'
import { getDb } from './index'
import { teams } from './schema'

export function dbListTeams(): Team[] {
	const rows = getDb()
		.select()
		.from(teams)
		.where(ne(teams.status, 'archived'))
		.orderBy(desc(teams.createdAt))
		.all()
	return rows.map(toTeam)
}

export function dbListTeamsByRepo(repoId: string): Team[] {
	const rows = getDb()
		.select()
		.from(teams)
		.where(and(eq(teams.repoId, repoId), ne(teams.status, 'archived')))
		.orderBy(desc(teams.createdAt))
		.all()
	return rows.map(toTeam)
}

export function dbGetTeam(id: string): Team | null {
	const row = getDb().select().from(teams).where(eq(teams.id, id)).get()
	return row ? toTeam(row) : null
}

export function dbInsertTeam(team: Team): void {
	getDb()
		.insert(teams)
		.values({
			id: team.id,
			repoId: team.repoId,
			worktreePath: team.worktreePath,
			task: team.task,
			title: team.title,
			status: team.status,
			pmSummary: team.pmSummary,
			port: team.port,
			prUrl: team.prUrl,
			createdAt: team.createdAt,
			updatedAt: team.updatedAt,
		})
		.run()
}

export function dbUpdateTeamTitle(id: string, title: string): void {
	getDb()
		.update(teams)
		.set({ title, updatedAt: Date.now() })
		.where(eq(teams.id, id))
		.run()
}

export function dbUpdateTeamStatus(
	id: string,
	status: TeamStatus,
	pmSummary?: string,
): void {
	const values: Record<string, unknown> = {
		status,
		updatedAt: Date.now(),
	}
	if (pmSummary !== undefined) {
		values.pmSummary = pmSummary
	}
	getDb().update(teams).set(values).where(eq(teams.id, id)).run()
}

export function dbUpdateTeamPort(id: string, port: number | null): void {
	getDb()
		.update(teams)
		.set({ port, updatedAt: Date.now() })
		.where(eq(teams.id, id))
		.run()
}

export function dbUpdateTeamPrUrl(id: string, prUrl: string): void {
	getDb()
		.update(teams)
		.set({ prUrl, updatedAt: Date.now() })
		.where(eq(teams.id, id))
		.run()
}

export function dbArchiveTeam(id: string): void {
	dbUpdateTeamStatus(id, 'archived')
}

function toTeam(row: typeof teams.$inferSelect): Team {
	return {
		id: row.id,
		repoId: row.repoId,
		worktreePath: row.worktreePath,
		task: row.task,
		title: row.title,
		status: row.status as TeamStatus,
		pmSummary: row.pmSummary,
		port: row.port,
		prUrl: row.prUrl,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	}
}
