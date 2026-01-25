import { type Subprocess, spawn } from 'bun'
import { loadSessions, type SessionData, saveSessions } from '../config'

const processes = new Map<string, Subprocess>()

export function startSession(session: SessionData): boolean {
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

	const state = loadSessions()
	state.sessions.push({ ...session, pid: proc.pid })
	state.nextPort = session.port + 1
	saveSessions(state)

	return true
}

export function stopSession(sessionId: string): boolean {
	const proc = processes.get(sessionId)
	if (proc) {
		proc.kill()
		processes.delete(sessionId)
	}

	spawn({
		cmd: ['tmux', 'kill-session', '-t', `klaude-${sessionId}`],
		stdout: 'ignore',
		stderr: 'ignore',
	})

	const state = loadSessions()
	state.sessions = state.sessions.filter(s => s.id !== sessionId)
	saveSessions(state)

	return true
}

export function cleanupStaleSessions() {
	const state = loadSessions()
	const validSessions: SessionData[] = []

	for (const session of state.sessions) {
		try {
			process.kill(session.pid, 0)
			validSessions.push(session)
		} catch {
			spawn({
				cmd: ['tmux', 'kill-session', '-t', `klaude-${session.id}`],
				stdout: 'ignore',
				stderr: 'ignore',
			})
		}
	}

	state.sessions = validSessions
	saveSessions(state)
}

export function getNextPort(): number {
	const state = loadSessions()
	return state.nextPort || 7681
}
