import { log } from '../config'
import { dbGetLatestEventByType } from '../db/events'
import { dbUpdateTeamStatus } from '../db/teams'
import type { Team } from '../types'
import { spawnPm } from './pm'
import { spawnDeveloper, spawnQaAgent, spawnReviewerAgent, spawnTeamLead } from './specialists'

export async function startOrchestrator() {
	log('orchestrator', 'starting')
}

export async function onNewTeam(team: Team) {
	log('orchestrator', 'spawning team', { teamId: team.id })

	// All team members spawn concurrently and self-coordinate via events.
	// Each polls the event stream and acts when their trigger arrives.
	await Promise.all([
		spawnTeamLead(team),
		spawnDeveloper(team),
		spawnQaAgent(team),
		spawnReviewerAgent(team),
	])

	// PM oversees the full lifecycle. Team is done when PM exits.
	await spawnPm(team, {
		onDone: () => {
			const event = dbGetLatestEventByType(team.id, 'pm:summary')
			const summary = event
				? (JSON.parse(event.payload) as { summary: string }).summary
				: null
			log('orchestrator', 'team done', { teamId: team.id })
			dbUpdateTeamStatus(team.id, 'done', summary ?? undefined)
		},
		onError: () => dbUpdateTeamStatus(team.id, 'blocked'),
	})
}
