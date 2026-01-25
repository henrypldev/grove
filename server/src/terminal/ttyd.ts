import { type Subprocess, spawn } from 'bun'
import { loadSessions, log, type SessionData, saveSessions } from '../config'

const processes = new Map<string, Subprocess>()

export async function startSession(session: SessionData): Promise<boolean> {
	log('ttyd', 'starting ttyd', { id: session.id, port: session.port })
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
		log('ttyd', 'failed to start ttyd', { id: session.id })
		return false
	}

	log('ttyd', 'ttyd started', { id: session.id, pid: proc.pid })
	processes.set(session.id, proc)

	const state = await loadSessions()
	state.sessions.push({ ...session, pid: proc.pid })
	state.nextPort = session.port + 1
	await saveSessions(state)

	return true
}

export async function stopSession(sessionId: string): Promise<boolean> {
	log('ttyd', 'stopping session', { id: sessionId })
	const proc = processes.get(sessionId)
	if (proc) {
		proc.kill()
		processes.delete(sessionId)
		log('ttyd', 'killed ttyd process', { id: sessionId })
	}

	await Bun.$`tmux kill-session -t klaude-${sessionId}`.quiet().nothrow()
	log('ttyd', 'killed tmux session', { id: sessionId })

	const state = await loadSessions()
	state.sessions = state.sessions.filter(s => s.id !== sessionId)
	await saveSessions(state)

	return true
}

export async function cleanupStaleSessions() {
	log('ttyd', 'cleaning up stale sessions')
	const state = await loadSessions()
	const validSessions: SessionData[] = []

	for (const session of state.sessions) {
		const result = await Bun.$`kill -0 ${session.pid}`.quiet().nothrow()
		if (result.exitCode === 0) {
			validSessions.push(session)
		} else {
			log('ttyd', 'removing stale session', {
				id: session.id,
				pid: session.pid,
			})
			await Bun.$`tmux kill-session -t klaude-${session.id}`.quiet().nothrow()
		}
	}

	log('ttyd', 'cleanup complete', {
		before: state.sessions.length,
		after: validSessions.length,
	})
	state.sessions = validSessions
	await saveSessions(state)
}

export async function getNextPort(): Promise<number> {
	const state = await loadSessions()
	return state.nextPort || 7681
}
