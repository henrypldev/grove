import { join } from 'node:path'

const CONFIG_DIR = Bun.env.XDG_CONFIG_HOME
	? join(Bun.env.XDG_CONFIG_HOME, 'grove')
	: join(Bun.env.HOME ?? '', '.config', 'grove')

const CONFIG_FILE = join(CONFIG_DIR, 'config.json')
const SESSIONS_FILE = join(CONFIG_DIR, 'sessions.json')
export const WORKTREES_DIR = join(Bun.env.HOME ?? '', '.claude-worktrees')

let logsEnabled = true

export function setLogsEnabled(enabled: boolean) {
	logsEnabled = enabled
}

export function log(context: string, message: string, data?: unknown) {
	if (!logsEnabled) return
	const timestamp = new Date().toISOString().slice(11, 23)
	const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : ''
	console.log(`[${timestamp}] [${context}] ${message}${dataStr}`)
}

export interface Repo {
	id: string
	path: string
	name: string
}

export interface SessionData {
	id: string
	repoId: string
	repoName: string
	worktree: string
	branch: string
	port: number
	terminalUrl: string
	pid: number
	createdAt: string
	skipPermissions?: boolean
}

let cachedTerminalHost: string | null = null

export async function getTerminalHost(): Promise<string> {
	if (cachedTerminalHost) return cachedTerminalHost
	if (Bun.env.TERMINAL_HOST) {
		cachedTerminalHost = Bun.env.TERMINAL_HOST
		return cachedTerminalHost
	}
	const result = await Bun.$`tailscale status --json`.quiet()
	const status = JSON.parse(result.text())
	cachedTerminalHost = status.Self.DNSName.replace(/\.$/, '')
	return cachedTerminalHost
}

const CERT_DIR = join(CONFIG_DIR, 'certs')

export async function ensureTailscaleCerts(): Promise<{
	cert: string
	key: string
}> {
	const host = await getTerminalHost()
	const certPath = join(CERT_DIR, `${host}.crt`)
	const keyPath = join(CERT_DIR, `${host}.key`)

	if (
		!(await Bun.file(certPath).exists()) ||
		!(await Bun.file(keyPath).exists())
	) {
		await Bun.$`mkdir -p ${CERT_DIR}`.quiet()
		await Bun.$`tailscale cert --cert-file ${certPath} --key-file ${keyPath} ${host}`
		log('config', 'generated tailscale certs', { host })
	}

	return { cert: certPath, key: keyPath }
}

interface Config {
	repos: Repo[]
}

interface SessionsState {
	sessions: SessionData[]
	nextPort: number
}

async function ensureConfigDir() {
	const dir = Bun.file(CONFIG_DIR)
	if (!(await dir.exists())) {
		await Bun.$`mkdir -p ${CONFIG_DIR}`.quiet()
	}
}

export async function loadConfig(): Promise<Config> {
	await ensureConfigDir()
	const file = Bun.file(CONFIG_FILE)
	if (!(await file.exists())) {
		return { repos: [] }
	}
	try {
		return await file.json()
	} catch {
		return { repos: [] }
	}
}

export async function saveConfig(config: Config) {
	await ensureConfigDir()
	await Bun.write(CONFIG_FILE, JSON.stringify(config, null, 2))
}

export async function loadSessions(): Promise<SessionsState> {
	await ensureConfigDir()
	const file = Bun.file(SESSIONS_FILE)
	if (!(await file.exists())) {
		return { sessions: [], nextPort: 7681 }
	}
	try {
		return await file.json()
	} catch {
		return { sessions: [], nextPort: 7681 }
	}
}

export async function saveSessions(state: SessionsState) {
	await ensureConfigDir()
	await Bun.write(SESSIONS_FILE, JSON.stringify(state, null, 2))
}

export function generateId(): string {
	return Math.random().toString(36).substring(2, 10)
}
