import { eq } from 'drizzle-orm'
import type { TeamDependency } from '../types'
import { getDb } from './index'
import { teamDependencies } from './schema'

export function dbInsertTeamDependency(
	teamId: string,
	dependsOnTeamId: string,
): void {
	getDb().insert(teamDependencies).values({ teamId, dependsOnTeamId }).run()
}

export function dbGetTeamDependencies(teamId: string): TeamDependency[] {
	return getDb()
		.select()
		.from(teamDependencies)
		.where(eq(teamDependencies.teamId, teamId))
		.all()
}

export function dbGetDependentTeams(teamId: string): TeamDependency[] {
	return getDb()
		.select()
		.from(teamDependencies)
		.where(eq(teamDependencies.dependsOnTeamId, teamId))
		.all()
}
