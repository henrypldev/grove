import {
	generateId,
	loadConfig,
	loadSessions,
	type SessionData,
} from '../config'
import { getNextPort, startSession, stopSession } from '../terminal/ttyd'
import { getWorktrees } from './worktrees'

export async function getSessions(): Promise<SessionData[]> {
	const state = await loadSessions()
	return state.sessions.map(({ pid, ...rest }) => rest) as SessionData[]
}

export async function createSession(
	repoId: string,
	worktreeBranch: string,
): Promise<SessionData | null> {
	const config = await loadConfig()
	const repo = config.repos.find(r => r.id === repoId)
	if (!repo) {
		return null
	}

	const worktrees = await getWorktrees(repoId)
	const worktree = worktrees.find(w => w.branch === worktreeBranch)
	if (!worktree) {
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
	}

	const started = await startSession(session)
	if (!started) {
		return null
	}

	return session
}

export async function deleteSession(id: string): Promise<boolean> {
	return stopSession(id)
}
