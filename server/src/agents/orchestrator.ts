import { computeDiff } from '../api/diff'
import { log } from '../config'
import { dbInsertEvent, subscribeToTeamEvents } from '../db/events'
import {
	dbGetTeam,
	dbUpdateTeamMetroPort,
	dbUpdateTeamStatus,
} from '../db/teams'
import type { AgentRole, Team } from '../types'
import { closeAllAgents, getAgent } from './agent-registry'
import { spawnPm } from './pm'
import {
	spawnDeveloper,
	spawnEnvAgent,
	spawnQaAgent,
	spawnReviewerAgent,
	spawnTeamLead,
} from './specialists'

const MENTION_PATTERN = /@(pm|team-lead|dev|qa|reviewer|env)\b/g

export async function startOrchestrator() {
	log('orchestrator', 'starting')
}

export async function onNewTeam(team: Team) {
	log('orchestrator', 'spawning team', { teamId: team.id })

	spawnEnvAgent(team).catch(err => {
		log('orchestrator', 'env agent spawn failed', { teamId: team.id, err })
	})

	await spawnPm(team, {
		onDone: () => {
			log('orchestrator', 'pm process exited', { teamId: team.id })
		},
		onError: () => dbUpdateTeamStatus(team.id, 'blocked'),
	})

	subscribeToTeamEvents(team.id, async event => {
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

		await routeMessageToAgents(team, text, event.agentId)
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
			const envAgent = getAgent(team.id, 'env')
			if (envAgent) {
				envAgent.queue.push(
					'dev:complete — please re-check the fingerprint for native dependency changes.',
				)
			}
		}
		if (event.type === 'pm:summary') {
			const summary = (() => {
				try {
					const p =
						typeof event.payload === 'string'
							? JSON.parse(event.payload)
							: event.payload
					return p.summary ?? null
				} catch {
					return null
				}
			})()
			log('orchestrator', 'pm:summary received, team idle', {
				teamId: team.id,
			})
			dbUpdateTeamStatus(team.id, 'idle', summary ?? undefined)
		}
	})
}

export async function routeMessageToAgents(
	team: Team,
	text: string,
	senderAgentId?: string,
) {
	const mentions = new Set<string>()
	for (const match of text.matchAll(MENTION_PATTERN)) {
		mentions.add(match[1])
	}

	if (mentions.size === 0) {
		const pmAgent = getAgent(team.id, 'pm')
		if (pmAgent && pmAgent.agentId !== senderAgentId) {
			log(
				'orchestrator',
				`routing to pm (default) from ${senderAgentId ?? 'user'}`,
				{
					teamId: team.id,
				},
			)
			pmAgent.queue.push(text)
		}
		return
	}

	for (const role of mentions) {
		if (role === 'pm') {
			const pmAgent = getAgent(team.id, 'pm')
			if (pmAgent && pmAgent.agentId !== senderAgentId) {
				log('orchestrator', `routing to pm from ${senderAgentId ?? 'user'}`, {
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
		if (agent && agent.agentId !== senderAgentId) {
			log(
				'orchestrator',
				`routing to ${role} from ${senderAgentId ?? 'user'}`,
				{
					teamId: team.id,
				},
			)
			agent.queue.push(text)
		}
	}
}

export async function closeTeam(teamId: string) {
	log('orchestrator', 'closing team', { teamId })
	const team = dbGetTeam(teamId)
	closeAllAgents(teamId)
	if (team?.metroPort) {
		await killPort(team.metroPort)
		dbUpdateTeamMetroPort(teamId, null)
	}
	dbUpdateTeamStatus(teamId, 'done')
}

async function killPort(port: number) {
	try {
		const proc = Bun.spawn(['lsof', '-ti', `:${port}`], {
			stdout: 'pipe',
			stderr: 'ignore',
		})
		const text = await new Response(proc.stdout).text()
		const pids = text.trim().split('\n').filter(Boolean)
		for (const pid of pids) {
			process.kill(Number(pid), 'SIGTERM')
		}
	} catch {}
}

async function spawnSpecialist(team: Team, role: AgentRole) {
	log('orchestrator', `spawning specialist ${role}`, { teamId: team.id })
	if (role === 'team-lead') await spawnTeamLead(team)
	else if (role === 'dev') await spawnDeveloper(team)
	else if (role === 'qa') await spawnQaAgent(team)
	else if (role === 'reviewer') await spawnReviewerAgent(team)
	else if (role === 'env') await spawnEnvAgent(team)
}
