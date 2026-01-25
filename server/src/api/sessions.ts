import { loadConfig, loadSessions, generateId, type SessionData } from '../config'
import { startSession, stopSession, getNextPort } from '../terminal/ttyd'
import { getWorktrees } from './worktrees'

export function getSessions(): SessionData[] {
  const state = loadSessions()
  return state.sessions.map(({ pid, ...rest }) => rest) as SessionData[]
}

export async function createSession(
  repoId: string,
  worktreeBranch: string
): Promise<SessionData | null> {
  const config = loadConfig()
  const repo = config.repos.find((r) => r.id === repoId)
  if (!repo) {
    return null
  }

  const worktrees = await getWorktrees(repoId)
  const worktree = worktrees.find((w) => w.branch === worktreeBranch)
  if (!worktree) {
    return null
  }

  const session: SessionData = {
    id: generateId(),
    repoId,
    repoName: repo.name,
    worktree: worktree.path,
    branch: worktree.branch,
    port: getNextPort(),
    pid: 0,
    createdAt: new Date().toISOString(),
  }

  const started = startSession(session)
  if (!started) {
    return null
  }

  return session
}

export function deleteSession(id: string): boolean {
  return stopSession(id)
}
