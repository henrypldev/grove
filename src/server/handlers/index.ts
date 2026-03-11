import { log } from '../config'
import { subscribeToTeamActivity } from '../db/activity'
import type { Handler } from './types'

const handlers: Handler[] = []
const teamUnsubscribers = new Map<string, (() => void)[]>()

export function registerHandler(h: Handler) {
	handlers.push(h)
}

export async function initHandlersForTeam(teamId: string) {
	const unsubs: (() => void)[] = []

	for (const handler of handlers) {
		if (handler.onTeamCreated) {
			await handler.onTeamCreated(teamId)
		}

		const unsub = subscribeToTeamActivity(teamId, async event => {
			if (handler.handles.includes(event.type)) {
				try {
					await handler.onActivity(teamId, event)
				} catch (err) {
					log('handler', `${handler.name} error handling ${event.type}`, {
						teamId,
						err,
					})
				}
			}
		})
		unsubs.push(unsub)
	}

	teamUnsubscribers.set(teamId, unsubs)
}

export async function teardownHandlersForTeam(teamId: string) {
	// Unsubscribe all activity listeners
	const unsubs = teamUnsubscribers.get(teamId)
	if (unsubs) {
		for (const unsub of unsubs) {
			unsub()
		}
		teamUnsubscribers.delete(teamId)
	}

	// Call onTeamClosing on all handlers
	for (const handler of handlers) {
		if (handler.onTeamClosing) {
			try {
				await handler.onTeamClosing(teamId)
			} catch (err) {
				log('handler', `${handler.name} error during team closing`, {
					teamId,
					err,
				})
			}
		}
	}
}
