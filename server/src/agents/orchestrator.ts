import { computeDiff } from '../api/diff'
import { log } from '../config'
import {
	dbGetLatestEventByType,
	dbInsertEvent,
	subscribeToTeamEvents,
} from '../db/events'
import { dbUpdateTeamStatus } from '../db/teams'
import type { AgentRole, Team } from '../types'
import { closeAllAgents, getAgent } from './agent-registry'
import { spawnPm } from './pm'
import {
	spawnDeveloper,
	spawnQaAgent,
	spawnReviewerAgent,
	spawnTeamLead,
} from './specialists'

const MENTION_PATTERN = /@(pm|team-lead|dev|qa|reviewer)\b/g

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

	const unsubscribe = subscribeToTeamEvents(team.id, async event => {
		if (event.type !== 'agent:message') return

		let payload: { text?: string }
		try {
			payload =
				typeof event.payload === 'string'
					? JSON.parse(event.payload)
					: event.payload
		} catch {
			return
		}

		const text = payload.text
		if (!text) return

		const mentions = new Set<string>()
		for (const match of text.matchAll(MENTION_PATTERN)) {
			mentions.add(match[1])
		}

		for (const role of mentions) {
			if (role === 'pm') {
				const pmAgent = getAgent(team.id, 'pm')
				if (pmAgent && pmAgent.agentId !== event.agentId) {
					log('orchestrator', `routing to pm from ${event.agentId}`, {
						teamId: team.id,
					})
					pmAgent.queue.push(text)
				}
				continue
			}

			let agent = getAgent(team.id, role)
			if (!agent) {
				await spawnSpecialist(team, role as AgentRole)
				agent = getAgent(team.id, role)
			}
			if (agent && agent.agentId !== event.agentId) {
				log('orchestrator', `routing to ${role} from ${event.agentId}`, {
					teamId: team.id,
				})
				agent.queue.push(text)
			}
		}
	})

	subscribeToTeamEvents(team.id, async event => {
		if (event.type === 'dev:complete') {
			let payload: { summary?: string }
			try {
				payload =
					typeof event.payload === 'string'
						? JSON.parse(event.payload)
						: event.payload
			} catch {
				payload = {}
			}
			const diff = await computeDiff(team.worktreePath)
			dbInsertEvent(team.id, event.agentId, 'agent:message', {
				text: `@pm done. ${payload.summary ?? ''}`,
				diff: diff ?? undefined,
			})
		}
		if (event.type === 'pm:summary') {
			log('orchestrator', 'pm:summary received, closing all agents', {
				teamId: team.id,
			})
			closeAllAgents(team.id)
			unsubscribe()
		}
	})
}

async function spawnSpecialist(team: Team, role: AgentRole) {
	log('orchestrator', `spawning specialist ${role}`, { teamId: team.id })
	if (role === 'team-lead') await spawnTeamLead(team)
	else if (role === 'dev') await spawnDeveloper(team)
	else if (role === 'qa') await spawnQaAgent(team)
	else if (role === 'reviewer') await spawnReviewerAgent(team)
}
