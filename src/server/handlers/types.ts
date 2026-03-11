import type { TeamActivity } from '../types'

export interface Handler {
	name: string
	handles: string[]
	onActivity(teamId: string, event: TeamActivity): Promise<void>
	onTeamCreated?(teamId: string): Promise<void>
	onTeamClosing?(teamId: string): Promise<void>
}
