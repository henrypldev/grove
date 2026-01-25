import {
	generateId,
	loadConfig,
	loadSessions,
	log,
	type SessionData,
} from '../config'
import { getNextPort, startSession, stopSession } from '../terminal/ttyd'
import { getWorktrees } from './worktrees'

export async function getSessions(): Promise<SessionData[]> {
	log('sessions', 'getting sessions')
	const state = await loadSessions()
	log('sessions', 'found sessions', { count: state.sessions.length })
	return state.sessions.map(({ pid, ...rest }) => rest) as SessionData[]
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

	const session: SessionData = {
		id: generateId(),
		repoId,
		repoName: repo.name,
		worktree: worktree.path,
		branch: worktree.branch,
		port: await getNextPort(),
		pid: 0,
		createdAt: new Date().toISOString(),
		skipPermissions,
	}

	log('sessions', 'starting session', { id: session.id, port: session.port })
	const started = await startSession(session)
	if (!started) {
		log('sessions', 'failed to start session', { id: session.id })
		return null
	}

	log('sessions', 'session created', { id: session.id })
	return session
}

export async function deleteSession(id: string): Promise<boolean> {
	log('sessions', 'deleting session', { id })
	return stopSession(id)
}
