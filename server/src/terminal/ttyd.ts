import { type Subprocess, spawn } from 'bun'
import { existsSync, writeFileSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import {
	ensureTailscaleCerts,
	loadSessions,
	log,
	type SessionData,
	saveSessions,
} from '../config'

function ensureTmuxMouseConfig() {
	const confPath = join(homedir(), '.tmux.conf')
	const mouseLine = 'set -g mouse on'
	if (existsSync(confPath)) {
		const content = readFileSync(confPath, 'utf-8')
		if (!content.includes(mouseLine)) {
			writeFileSync(confPath, content.trimEnd() + '\n' + mouseLine + '\n')
		}
	} else {
		writeFileSync(confPath, mouseLine + '\n')
	}
}

const processes = new Map<string, Subprocess>()

let sessionLock: Promise<void> = Promise.resolve()

export async function startSession(session: SessionData): Promise<boolean> {
	let resolve: () => void = () => {}
	const prevLock = sessionLock
	sessionLock = new Promise(r => {
		resolve = r
	})

	try {
		await prevLock

		const state = await loadSessions()
		const port = state.nextPort || 7681
		session.port = port

		log('ttyd', 'starting ttyd', { id: session.id, port })
		const { cert, key } = await ensureTailscaleCerts()
		const claudePath =
			(await Bun.$`which claude`.quiet().nothrow()).text().trim() || 'claude'
		const claudeArgs = session.skipPermissions
			? [claudePath, '--dangerously-skip-permissions']
			: [claudePath]
		ensureTmuxMouseConfig()
		const proc = spawn({
			cmd: [
				'ttyd',
				'-p',
				String(port),
				'-S',
				'-C',
				cert,
				'-K',
				key,
				'-W',
				'-t',
				'fontSize=30',
				'tmux',
				'new-session',
				'-A',
				'-s',
				`grove-${session.id}`,
				'-c',
				session.worktree,
				...claudeArgs,
			],
			stdout: 'ignore',
			stderr: 'ignore',
		})

		if (!proc.pid) {
			log('ttyd', 'failed to start ttyd', { id: session.id })
			return false
		}

		log('ttyd', 'ttyd started', { id: session.id, pid: proc.pid })
		setTimeout(async () => {
			const s = `grove-${session.id}`
			await Bun.$`tmux set-option -t ${s} mouse on`.quiet().nothrow()
			log('ttyd', 'enabled mouse for session', { id: session.id })
		}, 1000)
		processes.set(session.id, proc)

		state.sessions.push({ ...session, pid: proc.pid })
		state.nextPort = port + 1
		await saveSessions(state)

		return true
	} finally {
		resolve()
	}
}

export async function stopSession(sessionId: string): Promise<boolean> {
	log('ttyd', 'stopping session', { id: sessionId })
	const proc = processes.get(sessionId)
	if (proc) {
		proc.kill()
		processes.delete(sessionId)
		log('ttyd', 'killed ttyd process', { id: sessionId })
	} else {
		const state = await loadSessions()
		const session = state.sessions.find(s => s.id === sessionId)
		if (session?.pid) {
			await Bun.$`kill ${session.pid}`.quiet().nothrow()
			log('ttyd', 'killed ttyd by pid', { id: sessionId, pid: session.pid })
		}
	}

	await Bun.$`tmux kill-session -t grove-${sessionId}`.quiet().nothrow()
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
			await Bun.$`tmux kill-session -t grove-${session.id}`.quiet().nothrow()
		}
	}

	log('ttyd', 'cleanup complete', {
		before: state.sessions.length,
		after: validSessions.length,
	})
	state.sessions = validSessions
	await saveSessions(state)
}

export async function isSessionActive(pid: number): Promise<boolean> {
	const result = await Bun.$`kill -0 ${pid}`.quiet().nothrow()
	return result.exitCode === 0
}

export type SessionState = 'waiting' | 'busy' | 'idle'

export async function getSessionState(
	sessionId: string,
): Promise<SessionState> {
	const result = await Bun.$`tmux capture-pane -t grove-${sessionId} -p`
		.quiet()
		.nothrow()
	if (result.exitCode !== 0) {
		return 'idle'
	}
	const output = result.text()
	if (
		output.includes('✢') ||
		/\w+\.\.\..*\((\d+(?:m \d+)?s|[Ee]sc to interrupt)\)/.test(output)
	) {
		return 'busy'
	}
	if (output.includes('? for shortcuts')) {
		return 'waiting'
	}
	return 'busy'
}
