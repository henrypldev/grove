import {
	generateId,
	getTerminalHost,
	loadConfig,
	loadSessions,
	log,
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

export async function broadcastSessions() {
	const sessions = await getSessions()
	const data = `data: ${JSON.stringify({ type: 'sessions', sessions })}\n\n`
	for (const controller of sseClients) {
		try {
			controller.enqueue(new TextEncoder().encode(data))
		} catch {
			sseClients.delete(controller)
		}
	}
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
