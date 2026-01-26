import AsyncStorage from '@react-native-async-storage/async-storage'

const SERVER_URL_KEY = 'klaude_server_url'

let serverUrl: string | null = null

export async function getServerUrl(): Promise<string | null> {
	if (serverUrl) return serverUrl
	serverUrl = await AsyncStorage.getItem(SERVER_URL_KEY)
	return serverUrl
}

export async function setServerUrl(url: string): Promise<void> {
	serverUrl = url
	await AsyncStorage.setItem(SERVER_URL_KEY, url)
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
	const baseUrl = await getServerUrl()
	if (!baseUrl) {
		throw new Error('Server URL not configured')
	}
	const res = await fetch(`${baseUrl}${path}`, {
		...options,
		headers: {
			'Content-Type': 'application/json',
			...options?.headers,
		},
	})
	if (!res.ok) {
		throw new Error(`API error: ${res.status}`)
	}
	return res.json()
}

export interface Session {
	id: string
	repoId: string
	repoName: string
	worktree: string
	branch: string
	port: number
	terminalUrl: string
	createdAt: string
}

export interface Repo {
	id: string
	path: string
	name: string
}

export interface Worktree {
	path: string
	branch: string
	isMain: boolean
}

export const api = {
	getSessions: () => fetchApi<Session[]>('/sessions'),

	createSession: (data: {
		repoId: string
		worktree: string
		skipPermissions?: boolean
	}) =>
		fetchApi<Session>('/sessions', {
			method: 'POST',
			body: JSON.stringify(data),
		}),

	deleteSession: (id: string) =>
		fetchApi<void>(`/sessions/${id}`, { method: 'DELETE' }),

	getRepos: () => fetchApi<Repo[]>('/repos'),

	addRepo: (path: string) =>
		fetchApi<Repo>('/repos', {
			method: 'POST',
			body: JSON.stringify({ path }),
		}),

	deleteRepo: (id: string) =>
		fetchApi<void>(`/repos/${id}`, { method: 'DELETE' }),

	getWorktrees: (repoId: string) =>
		fetchApi<Worktree[]>(`/worktrees/${repoId}`),

	createWorktree: (data: {
		repoId: string
		branch: string
		baseBranch: string
	}) =>
		fetchApi<Worktree>('/worktrees', {
			method: 'POST',
			body: JSON.stringify(data),
		}),

	deleteWorktree: (data: { repoId: string; branch: string }) =>
		fetchApi<void>('/worktrees', {
			method: 'DELETE',
			body: JSON.stringify(data),
		}),
}
