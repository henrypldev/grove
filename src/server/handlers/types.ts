import type { TeamActivity } from '../types'

export interface Handler {
	name: string
	handles: string[]
	onActivity(teamId: string, event: TeamActivity): Promise<void>
	onTeamCreated?(teamId: string): Promise<void>
	onTeamClosing?(teamId: string): Promise<void>
}

export function parsePayload<T = Record<string, unknown>>(
	payload: string | T,
	fallback: T = {} as T,
): T {
	try {
		return typeof payload === 'string' ? JSON.parse(payload) : payload
	} catch {
		return fallback
	}
}
