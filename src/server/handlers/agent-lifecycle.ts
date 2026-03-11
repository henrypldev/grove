import { closeAgent, closeTaskAgent } from '../agents/agent-registry'
import { log } from '../config'
import { dbUpdateTeamStatus } from '../db/teams'
import type { TeamActivity } from '../types'
import type { Handler } from './types'

export const agentLifecycleHandler: Handler = {
	name: 'agent-lifecycle',
	handles: ['task:complete', 'pm:summary'],

	async onActivity(teamId: string, event: TeamActivity) {
		if (event.type === 'task:complete') {
			let payload: { taskId?: string }
			try {
				payload =
					typeof event.payload === 'string'
						? JSON.parse(event.payload)
						: event.payload
			} catch {
				payload = {}
			}
			if (payload.taskId) {
				log('handler', `task ${payload.taskId} complete, closing task dev`, {
					teamId,
				})
				closeTaskAgent(teamId, payload.taskId)
			} else {
				log('handler', 'task complete, cycling dev agent', { teamId })
				closeAgent(teamId, 'dev')
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
			log('handler', 'pm:summary received, team done', { teamId })
			dbUpdateTeamStatus(teamId, 'done', summary ?? undefined)
		}
	},
}
