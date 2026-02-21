import { log } from '../config'
import { dbGetLatestEventByType } from '../db/events'
import { dbUpdateTeamStatus } from '../db/teams'
import type { Team } from '../types'
import { spawnPm } from './pm'

export async function startOrchestrator() {
	log('orchestrator', 'starting')
}

export async function onNewTeam(team: Team) {
	log('orchestrator', 'spawning team', { teamId: team.id })

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
