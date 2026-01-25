import { join } from 'node:path'

const CONFIG_DIR = Bun.env.XDG_CONFIG_HOME
	? join(Bun.env.XDG_CONFIG_HOME, 'klaude')
	: join(Bun.env.HOME ?? '', '.config', 'klaude')

const CONFIG_FILE = join(CONFIG_DIR, 'config.json')
const SESSIONS_FILE = join(CONFIG_DIR, 'sessions.json')
export const WORKTREES_DIR = join(Bun.env.HOME ?? '', '.claude-worktrees')

export function log(context: string, message: string, data?: unknown) {
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
	pid: number
	createdAt: string
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
