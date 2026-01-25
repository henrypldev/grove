import { type Subprocess, spawn } from 'bun'
import { loadSessions, type SessionData, saveSessions } from '../config'

const processes = new Map<string, Subprocess>()

export async function startSession(session: SessionData): Promise<boolean> {
	const proc = spawn({
		cmd: [
			'ttyd',
			'-p',
			String(session.port),
			'-W',
			'-t',
			'fontSize=25',
			'tmux',
			'new-session',
			'-A',
			'-s',
			`klaude-${session.id}`,
			'-c',
			session.worktree,
			'claude',
		],
		stdout: 'ignore',
		stderr: 'ignore',
	})

	if (!proc.pid) {
		return false
	}

	processes.set(session.id, proc)

	const state = await loadSessions()
	state.sessions.push({ ...session, pid: proc.pid })
	state.nextPort = session.port + 1
	await saveSessions(state)

	return true
}

export async function stopSession(sessionId: string): Promise<boolean> {
	const proc = processes.get(sessionId)
	if (proc) {
		proc.kill()
		processes.delete(sessionId)
	}

	await Bun.$`tmux kill-session -t klaude-${sessionId}`.quiet().nothrow()

	const state = await loadSessions()
	state.sessions = state.sessions.filter(s => s.id !== sessionId)
	await saveSessions(state)

	return true
}

export async function cleanupStaleSessions() {
	const state = await loadSessions()
	const validSessions: SessionData[] = []

	for (const session of state.sessions) {
		const result = await Bun.$`kill -0 ${session.pid}`.quiet().nothrow()
		if (result.exitCode === 0) {
			validSessions.push(session)
		} else {
			await Bun.$`tmux kill-session -t klaude-${session.id}`.quiet().nothrow()
		}
	}

	state.sessions = validSessions
	await saveSessions(state)
}

export async function getNextPort(): Promise<number> {
	const state = await loadSessions()
	return state.nextPort || 7681
}
