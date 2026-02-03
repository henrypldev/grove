import { join } from 'node:path'
import { type Subprocess, spawn } from 'bun'
import {
	ensureTailscaleCerts,
	loadSessions,
	log,
	type SessionData,
	saveSessions,
} from '../config'

async function ensureTmuxConfig() {
	const confPath = join(Bun.env.HOME || '', '.tmux.conf')
	const requiredLines = [
		'set -g mouse on',
		'set -s extended-keys on',
		"set -as terminal-features 'xterm*:extkeys'",
	]
	const file = Bun.file(confPath)
	if (await file.exists()) {
		const content = await file.text()
		const missing = requiredLines.filter(line => !content.includes(line))
		if (missing.length > 0) {
			await Bun.write(confPath, `${content.trimEnd()}\n${missing.join('\n')}\n`)
		}
	} else {
		await Bun.write(confPath, `${requiredLines.join('\n')}\n`)
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
		await ensureTmuxConfig()
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
	const result = await Bun.$`tmux capture-pane -t grove-${sessionId} -p -S -`
		.quiet()
		.nothrow()
	if (result.exitCode !== 0) {
		return 'idle'
	}
	const lines = result
		.text()
		.split('\n')
		.filter(l => l.trim() !== '')
	const tail = lines.slice(-30)
	for (let i = tail.length - 1; i >= 0; i--) {
		const line = tail[i]
		if (
			line.includes('esc to interrupt') ||
			/·\s+\S.*[.…]/.test(line) ||
			line.includes('Running…')
		) {
			return 'busy'
		}
		if (
			line.includes('❯') ||
			line.includes('? for shortcuts') ||
			/✻ (Worked|Crunched) for/.test(line) ||
			/\b(Allow|Deny|Yes|No|allow|deny)\b/.test(line)
		) {
			return 'waiting'
		}
	}
	return 'waiting'
}
