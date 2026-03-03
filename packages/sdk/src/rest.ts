import type { Team, TeamActivity } from '@usegrove/shared'

export class GroveRestClient {
	private baseUrl: string

	constructor(wsUrl: string) {
		this.baseUrl = wsUrl
			.replace('wss://', 'https://')
			.replace('ws://', 'http://')
			.replace(/\/ws\/?$/, '')
	}

	teams = {
		create: async (params: {
			repoId: string
			task: string
			files?: File[]
		}): Promise<Team | { teams: Team[] }> => {
			const formData = new FormData()
			formData.append('repoId', params.repoId)
			formData.append('task', params.task)
			if (params.files) {
				for (const file of params.files) {
					formData.append('files', file)
				}
			}
			const res = await fetch(`${this.baseUrl}/v2/teams`, {
				method: 'POST',
				body: formData,
			})
			if (!res.ok) {
				const err = await res.json()
				throw new Error(err.error ?? `HTTP ${res.status}`)
			}
			return res.json()
		},

		sendMessage: async (params: {
			id: string
			text: string
			files?: File[]
		}): Promise<TeamActivity> => {
			const formData = new FormData()
			formData.append('text', params.text)
			if (params.files) {
				for (const file of params.files) {
					formData.append('files', file)
				}
			}
			const res = await fetch(
				`${this.baseUrl}/v2/teams/${params.id}/messages`,
				{
					method: 'POST',
					body: formData,
				},
			)
			if (!res.ok) {
				const err = await res.json()
				throw new Error(err.error ?? `HTTP ${res.status}`)
			}
			return res.json()
		},
	}
}
