import AsyncStorage from '@react-native-async-storage/async-storage'
import EventSource from 'react-native-sse'

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

export type SessionState = 'waiting' | 'busy' | 'idle'

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
	state: SessionState
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
let eventSource: EventSource | null = null
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null

async function startSSEConnection() {
	if (eventSource) return

	const baseUrl = await getServerUrl()
	if (!baseUrl) {
		setConnectionState({ connected: false, url: null })
		return
	}

	eventSource = new EventSource(`${baseUrl}/events`)

	eventSource.addEventListener('open', () => {
		setConnectionState({ connected: true, url: baseUrl })
	})

	eventSource.addEventListener('message', event => {
		if (!event.data) return
		try {
			const data = JSON.parse(event.data)
			if (data.type === 'sessions') {
				for (const listener of sessionsListeners) {
					listener(data.sessions)
				}
			}
		} catch {}
	})

	eventSource.addEventListener('error', () => {
		eventSource?.close()
		eventSource = null
		setConnectionState({ connected: false, url: baseUrl })
		scheduleReconnect()
	})
}

function stopSSEConnection() {
	if (reconnectTimeout) {
		clearTimeout(reconnectTimeout)
		reconnectTimeout = null
	}
	eventSource?.close()
	eventSource = null
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

export function subscribeToEvents(onSessions: SessionsListener): () => void {
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
