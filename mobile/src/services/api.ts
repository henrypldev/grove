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
type SessionsListener = (sessions: Session[]) => void

const connectionListeners = new Set<ConnectionListener>()
const sessionsListeners = new Set<SessionsListener>()
let connectionState: ConnectionState = { connected: false, url: null }
let sseController: AbortController | null = null
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null

function startSSEConnection() {
	if (sseController) return

	const connect = async () => {
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
				scheduleReconnect()
				return
			}

			setConnectionState({ connected: true, url: baseUrl })
			const reader = res.body.getReader()
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
						try {
							const data = JSON.parse(line.slice(6))
							if (data.type === 'sessions') {
								for (const listener of sessionsListeners) {
									listener(data.sessions)
								}
							}
						} catch {}
					}
				}
			}
		} catch {}

		sseController = null
		setConnectionState({ connected: false, url: connectionState.url })
		scheduleReconnect()
	}

	connect()
}

function stopSSEConnection() {
	if (reconnectTimeout) {
		clearTimeout(reconnectTimeout)
		reconnectTimeout = null
	}
	sseController?.abort()
	sseController = null
}

function scheduleReconnect() {
	if (connectionListeners.size > 0 || sessionsListeners.size > 0) {
		reconnectTimeout = setTimeout(() => {
			reconnectTimeout = null
			startSSEConnection()
		}, 3000)
	}
}

function setConnectionState(state: ConnectionState) {
	connectionState = state
	for (const listener of connectionListeners) {
		listener(state)
	}
}

export function subscribeToConnection(
	listener: ConnectionListener,
): () => void {
	connectionListeners.add(listener)
	listener(connectionState)
	startSSEConnection()
	return () => {
		connectionListeners.delete(listener)
		if (connectionListeners.size === 0 && sessionsListeners.size === 0) {
			stopSSEConnection()
		}
	}
}

export function subscribeToEvents(
	onSessions: SessionsListener,
): () => void {
	sessionsListeners.add(onSessions)
	startSSEConnection()
	return () => {
		sessionsListeners.delete(onSessions)
		if (connectionListeners.size === 0 && sessionsListeners.size === 0) {
			stopSSEConnection()
		}
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
