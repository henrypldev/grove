import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadPid, removePid } from './config.js'
import { stopFunnel } from './tunnel.js'

const SESSIONS_FILE = join(homedir(), '.config', 'grove', 'sessions.json')

interface SessionData {
	id: string
	pid: number
}

interface SessionsState {
	sessions: SessionData[]
}

function loadSessions(): SessionsState {
	if (!existsSync(SESSIONS_FILE)) {
		return { sessions: [] }
	}
	try {
		const data = readFileSync(SESSIONS_FILE, 'utf-8')
		return JSON.parse(data)
	} catch {
		return { sessions: [] }
	}
}

function killProcess(pid: number): boolean {
	try {
		process.kill(pid, 'SIGTERM')
		return true
	} catch {
		return false
	}
}

function killTmuxSession(sessionId: string): void {
	spawnSync('tmux', ['kill-session', '-t', `grove-${sessionId}`], {
		stdio: 'ignore',
	})
}

export function stopAll(): { stopped: boolean; message: string } {
	const pid = loadPid()
	if (!pid) {
		return { stopped: false, message: 'No background server running' }
	}

	const sessions = loadSessions()
	for (const session of sessions.sessions) {
		killProcess(session.pid)
		killTmuxSession(session.id)
	}

	spawnSync('tmux', ['kill-session', '-t', 'grove'], { stdio: 'ignore' })

	killProcess(pid)
	stopFunnel()
	removePid()

	const sessionCount = sessions.sessions.length
	const sessionText = sessionCount === 1 ? 'session' : 'sessions'
	return {
		stopped: true,
		message: `grove stopped (killed ${sessionCount} ${sessionText})`,
	}
}

export function isRunning(): boolean {
	const pid = loadPid()
	if (!pid) return false
	try {
		process.kill(pid, 0)
		return true
	} catch {
		removePid()
		return false
	}
}
