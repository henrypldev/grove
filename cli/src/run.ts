import { execSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { getTailscaleInfo } from './tunnel.js'

const CONFIG_DIR = join(homedir(), '.config', 'grove')
const SESSIONS_FILE = join(CONFIG_DIR, 'sessions.json')
const CERT_DIR = join(CONFIG_DIR, 'certs')

interface SessionData {
	id: string
	repoId: string
	repoName: string
	worktree: string
	branch: string
	port: number
	terminalUrl: string
	pid: number
	createdAt: string
	command?: string
}

interface SessionsState {
	sessions: SessionData[]
	nextPort: number
}

function generateId(): string {
	return Math.random().toString(36).substring(2, 10)
}

function loadSessions(): SessionsState {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true })
	}
	if (!existsSync(SESSIONS_FILE)) {
		return { sessions: [], nextPort: 7681 }
	}
	try {
		const data = readFileSync(SESSIONS_FILE, 'utf-8')
		return JSON.parse(data)
	} catch {
		return { sessions: [], nextPort: 7681 }
	}
}

function saveSessions(state: SessionsState): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true })
	}
	writeFileSync(SESSIONS_FILE, JSON.stringify(state, null, 2))
}

function getGitInfo(): { repoName: string; branch: string } | null {
	try {
		const branch = execSync('git rev-parse --abbrev-ref HEAD', {
			encoding: 'utf-8',
			stdio: ['pipe', 'pipe', 'pipe'],
		}).trim()
		const topLevel = execSync('git rev-parse --show-toplevel', {
			encoding: 'utf-8',
			stdio: ['pipe', 'pipe', 'pipe'],
		}).trim()
		const repoName = basename(topLevel)
		return { repoName, branch }
	} catch {
		return null
	}
}

function ensureTailscaleCerts(hostname: string): { cert: string; key: string } {
	if (!existsSync(CERT_DIR)) {
		mkdirSync(CERT_DIR, { recursive: true })
	}
	const certPath = join(CERT_DIR, `${hostname}.crt`)
	const keyPath = join(CERT_DIR, `${hostname}.key`)

	if (!existsSync(certPath) || !existsSync(keyPath)) {
		execSync(
			`tailscale cert --cert-file ${certPath} --key-file ${keyPath} ${hostname}`,
			{ stdio: 'inherit' },
		)
	}

	return { cert: certPath, key: keyPath }
}

function removeSession(sessionId: string): void {
	const state = loadSessions()
	state.sessions = state.sessions.filter(s => s.id !== sessionId)
	saveSessions(state)
}

export function runCommand(command: string): void {
	const cwd = process.cwd()
	const gitInfo = getGitInfo()
	const repoName = gitInfo?.repoName ?? basename(cwd)
	const branch = gitInfo?.branch ?? 'main'

	const info = getTailscaleInfo()
	if (!info) {
		console.error('Error: Tailscale is not running or not connected')
		process.exit(1)
	}

	const sessionId = generateId()
	const state = loadSessions()
	const port = state.nextPort || 7681

	const { cert, key } = ensureTailscaleCerts(info.hostname)

	const tmuxSession = `grove-${sessionId}`

	const tmuxResult = spawnSync(
		'tmux',
		['new-session', '-d', '-s', tmuxSession, '-c', cwd, command],
		{ stdio: 'ignore' },
	)

	if (tmuxResult.status !== 0) {
		console.error('Error: Failed to create tmux session')
		process.exit(1)
	}

	const ttydProc = spawn(
		'ttyd',
		[
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
			'attach',
			'-t',
			tmuxSession,
		],
		{
			stdio: 'ignore',
			detached: true,
		},
	)

	if (!ttydProc.pid) {
		console.error('Error: Failed to start ttyd')
		process.exit(1)
	}

	ttydProc.unref()

	const session: SessionData = {
		id: sessionId,
		repoId: `local-${sessionId}`,
		repoName,
		worktree: cwd,
		branch,
		port,
		terminalUrl: `https://${info.hostname}:${port}`,
		pid: ttydProc.pid,
		createdAt: new Date().toISOString(),
		command,
	}

	state.sessions.push(session)
	state.nextPort = port + 1
	saveSessions(state)

	console.log(`Grove session started: ${session.terminalUrl}`)
	console.log(`Repo: ${repoName} (${branch})`)
	console.log('')

	const cleanup = () => {
		try {
			if (ttydProc.pid) process.kill(ttydProc.pid, 'SIGTERM')
		} catch {}
		spawnSync('tmux', ['kill-session', '-t', tmuxSession], { stdio: 'ignore' })
		removeSession(sessionId)
	}

	process.on('SIGINT', () => {
		cleanup()
		process.exit(0)
	})
	process.on('SIGTERM', () => {
		cleanup()
		process.exit(0)
	})

	const result = spawnSync('tmux', ['attach', '-t', tmuxSession], {
		stdio: 'inherit',
	})

	cleanup()
	process.exit(result.status ?? 0)
}
