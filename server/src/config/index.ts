import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const CONFIG_DIR = process.env.XDG_CONFIG_HOME
	? join(process.env.XDG_CONFIG_HOME, 'klaude')
	: join(homedir(), '.config', 'klaude')

const CONFIG_FILE = join(CONFIG_DIR, 'config.json')
const SESSIONS_FILE = join(CONFIG_DIR, 'sessions.json')

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

function ensureConfigDir() {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true })
	}
}

export function loadConfig(): Config {
	ensureConfigDir()
	if (!existsSync(CONFIG_FILE)) {
		return { repos: [] }
	}
	try {
		return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
	} catch {
		return { repos: [] }
	}
}

export function saveConfig(config: Config) {
	ensureConfigDir()
	writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
}

export function loadSessions(): SessionsState {
	ensureConfigDir()
	if (!existsSync(SESSIONS_FILE)) {
		return { sessions: [], nextPort: 7681 }
	}
	try {
		return JSON.parse(readFileSync(SESSIONS_FILE, 'utf-8'))
	} catch {
		return { sessions: [], nextPort: 7681 }
	}
}

export function saveSessions(state: SessionsState) {
	ensureConfigDir()
	writeFileSync(SESSIONS_FILE, JSON.stringify(state, null, 2))
}

export function generateId(): string {
	return Math.random().toString(36).substring(2, 10)
}
