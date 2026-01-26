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
	isActive: boolean
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

type ConnectionState = { connected: boolean; url: string | null }
type ConnectionListener = (state: ConnectionState) => void
const connectionListeners = new Set<ConnectionListener>()
let connectionState: ConnectionState = { connected: false, url: null }
let sseController: AbortController | null = null

export function subscribeToConnection(
	listener: ConnectionListener,
): () => void {
	connectionListeners.add(listener)
	listener(connectionState)
	if (connectionListeners.size === 1) {
		startSSEConnection()
	}
	return () => {
		connectionListeners.delete(listener)
		if (connectionListeners.size === 0) {
			sseController?.abort()
			sseController = null
		}
	}
}

function setConnectionState(state: ConnectionState) {
	connectionState = state
	for (const listener of connectionListeners) {
		listener(state)
	}
}

async function startSSEConnection() {
	const baseUrl = await getServerUrl()
	if (!baseUrl) {
		setConnectionState({ connected: false, url: null })
		return
	}

	sseController = new AbortController()

	try {
		const res = await fetch(`${baseUrl}/events`, {
			signal: sseController.signal,
		})
		if (!res.body) {
			setConnectionState({ connected: false, url: baseUrl })
			return
		}
		setConnectionState({ connected: true, url: baseUrl })

		const reader = res.body.getReader()
		while (true) {
			const { done } = await reader.read()
			if (done) break
		}
	} catch {}
	setConnectionState({ connected: false, url: baseUrl })

	if (connectionListeners.size > 0) {
		setTimeout(startSSEConnection, 3000)
	}
}

export function subscribeToEvents(
	onSessions: (sessions: Session[]) => void,
): () => void {
	let controller: AbortController | null = null

	const connect = async () => {
		const baseUrl = await getServerUrl()
		if (!baseUrl) return

		controller = new AbortController()
		try {
			const res = await fetch(`${baseUrl}/events`, {
				signal: controller.signal,
			})
			const reader = res.body?.getReader()
			if (!reader) return

			const decoder = new TextDecoder()
			let buffer = ''

			while (true) {
				const { done, value } = await reader.read()
				if (done) break

				buffer += decoder.decode(value, { stream: true })
				const lines = buffer.split('\n\n')
				buffer = lines.pop() || ''

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						const data = JSON.parse(line.slice(6))
						if (data.type === 'sessions') {
							onSessions(data.sessions)
						}
					}
				}
			}
		} catch {}
	}

	connect()

	return () => {
		controller?.abort()
	}
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
