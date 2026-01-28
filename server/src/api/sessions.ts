import {
	generateId,
	getTerminalHost,
	loadConfig,
	loadSessions,
	log,
	saveConfig,
	type SessionData,
} from '../config'
import {
	getSessionState,
	isSessionActive,
	type SessionState,
	startSession,
	stopSession,
} from '../terminal/ttyd'
import { getWorktrees } from './worktrees'

export type SessionWithStatus = Omit<SessionData, 'pid'> & {
	isActive: boolean
	state: SessionState
}

const sseClients = new Set<ReadableStreamDefaultController>()
const previousStates = new Map<string, SessionState>()
let stateInterval: ReturnType<typeof setInterval> | null = null

function startStatePolling() {
	if (stateInterval) return
	stateInterval = setInterval(() => {
		if (sseClients.size > 0) {
			broadcastSessions()
		}
	}, 2000)
}

function stopStatePolling() {
	if (stateInterval) {
		clearInterval(stateInterval)
		stateInterval = null
	}
}

export function addSSEClient(controller: ReadableStreamDefaultController) {
	sseClients.add(controller)
	startStatePolling()
}

export function removeSSEClient(controller: ReadableStreamDefaultController) {
	sseClients.delete(controller)
	if (sseClients.size === 0) {
		stopStatePolling()
	}
}

function broadcastSSE(data: string) {
	const encoded = new TextEncoder().encode(data)
	for (const controller of sseClients) {
		try {
			controller.enqueue(encoded)
		} catch {
			sseClients.delete(controller)
		}
	}
}

async function fireWebhook(payload: object) {
	const config = await loadConfig()
	if (!config.webhookUrl) return
	try {
		await fetch(config.webhookUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		})
	} catch (err) {
		log('webhook', 'failed to send', { error: String(err) })
	}
}

export async function broadcastSessions() {
	const sessions = await getSessions()

	for (const session of sessions) {
		const prev = previousStates.get(session.id)
		if (prev === 'busy' && session.state === 'waiting') {
			const payload = {
				type: 'state_change',
				session: {
					id: session.id,
					repoName: session.repoName,
					branch: session.branch,
				},
				from: 'busy',
				to: 'waiting',
			}
			broadcastSSE(`data: ${JSON.stringify(payload)}\n\n`)
			fireWebhook(payload)
		}
		previousStates.set(session.id, session.state)
	}

	broadcastSSE(`data: ${JSON.stringify({ type: 'sessions', sessions })}\n\n`)
}

export async function setWebhookUrl(url: string) {
	const config = await loadConfig()
	config.webhookUrl = url
	await saveConfig(config)
}

export async function removeWebhookUrl() {
	const config = await loadConfig()
	delete config.webhookUrl
	await saveConfig(config)
}

export async function getWebhookUrl(): Promise<string | undefined> {
	const config = await loadConfig()
	return config.webhookUrl
}

export async function getSessions(): Promise<SessionWithStatus[]> {
	log('sessions', 'getting sessions')
	const sessionsState = await loadSessions()
	const terminalHost = await getTerminalHost()
	log('sessions', 'found sessions', { count: sessionsState.sessions.length })
	const sessions = await Promise.all(
		sessionsState.sessions.map(async ({ pid, ...rest }) => {
			const isActive = await isSessionActive(pid)
			return {
				...rest,
				terminalUrl: rest.terminalUrl || `https://${terminalHost}:${rest.port}`,
				isActive,
				state: isActive
					? await getSessionState(rest.id)
					: ('idle' as SessionState),
			}
		}),
	)
	return sessions
}

export async function createSession(
	repoId: string,
	worktreeBranch: string,
	skipPermissions?: boolean,
): Promise<SessionData | null> {
	log('sessions', 'creating session', { repoId, worktreeBranch })
	const config = await loadConfig()
	const repo = config.repos.find(r => r.id === repoId)
	if (!repo) {
		log('sessions', 'repo not found', { repoId })
		return null
	}

	const worktrees = await getWorktrees(repoId)
	const worktree = worktrees.find(w => w.branch === worktreeBranch)
	if (!worktree) {
		log('sessions', 'worktree not found', { worktreeBranch })
		return null
	}

	const terminalHost = await getTerminalHost()
	const session: SessionData = {
		id: generateId(),
		repoId,
		repoName: repo.name,
		worktree: worktree.path,
		branch: worktree.branch,
		port: 0,
		terminalUrl: '',
		pid: 0,
		createdAt: new Date().toISOString(),
		skipPermissions,
	}

	log('sessions', 'starting session', { id: session.id })
	const started = await startSession(session)
	if (!started) {
		log('sessions', 'failed to start session', { id: session.id })
		return null
	}

	session.terminalUrl = `https://${terminalHost}:${session.port}`
	log('sessions', 'session created', { id: session.id, port: session.port })
	broadcastSessions()
	return session
}

export async function deleteSession(id: string): Promise<boolean> {
	log('sessions', 'deleting session', { id })
	const result = await stopSession(id)
	if (result) broadcastSessions()
	return result
}
