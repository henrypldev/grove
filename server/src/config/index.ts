import { appendFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

export type {
	EnvVar,
	PushToken,
	Repo,
	SessionData,
	SetupStep,
} from '../types'

import type { PushToken, Repo, SessionData } from '../types'

export const GROVE_DIR = join(Bun.env.HOME ?? '', '.grove')

const CONFIG_FILE = join(GROVE_DIR, 'config.json')
const SESSIONS_FILE = join(GROVE_DIR, 'sessions.json')
export const LOG_FILE = join(GROVE_DIR, 'server.log')
export const WORKTREES_DIR = join(GROVE_DIR, 'worktrees')

let logsEnabled = true

export function setLogsEnabled(enabled: boolean) {
	logsEnabled = enabled
}

export function log(context: string, message: string, data?: unknown) {
	const timestamp = new Date().toISOString().slice(11, 23)
	const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : ''
	const line = `[${timestamp}] [${context}] ${message}${dataStr}`
	if (logsEnabled) {
		console.log(line)
	}
	try {
		appendFileSync(LOG_FILE, `${line}\n`)
	} catch {}
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
	cachedTerminalHost = status.Self.DNSName.replace(/\.$/, '') as string
	return cachedTerminalHost
}

const CERT_DIR = join(GROVE_DIR, 'certs')

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
	webhookUrl?: string
	cloneDirectory?: string
	pushTokens?: PushToken[]
	settings?: Record<string, string>
}

interface SessionsState {
	sessions: SessionData[]
	nextPort: number
}

async function ensureConfigDir() {
	const dir = Bun.file(GROVE_DIR)
	if (!(await dir.exists())) {
		await Bun.$`mkdir -p ${GROVE_DIR}`.quiet()
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

export async function getPushTokens(): Promise<PushToken[]> {
	const config = await loadConfig()
	return config.pushTokens ?? []
}

export async function addPushToken(
	token: string,
	platform: 'ios' | 'android',
): Promise<void> {
	const config = await loadConfig()
	if (!config.pushTokens) config.pushTokens = []
	const existing = config.pushTokens.find(t => t.token === token)
	if (existing) {
		existing.platform = platform
		existing.registeredAt = new Date().toISOString()
	} else {
		config.pushTokens.push({
			token,
			platform,
			registeredAt: new Date().toISOString(),
		})
	}
	await saveConfig(config)
}

export async function removePushToken(token: string): Promise<boolean> {
	const config = await loadConfig()
	if (!config.pushTokens) return false
	const index = config.pushTokens.findIndex(t => t.token === token)
	if (index === -1) return false
	config.pushTokens.splice(index, 1)
	await saveConfig(config)
	return true
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

export async function getCloneDirectory(): Promise<string> {
	const config = await loadConfig()
	return config.cloneDirectory ?? join(GROVE_DIR, 'repos')
}

export function listDirectories(path: string): string[] {
	try {
		let parentDir: string
		let prefix: string

		if (path.endsWith('/')) {
			parentDir = path
			prefix = ''
		} else {
			parentDir = dirname(path)
			prefix = basename(path).toLowerCase()
		}

		const entries = readdirSync(parentDir, { withFileTypes: true })
		const dirs = entries
			.filter(e => {
				if (!e.isDirectory()) return false
				if (e.name.startsWith('.')) return false
				if (prefix && !e.name.toLowerCase().startsWith(prefix)) return false
				return true
			})
			.map(e => join(parentDir, e.name))
			.slice(0, 50)

		return dirs
	} catch {
		return []
	}
}

export async function getSetting(key: string): Promise<string | null> {
	const config = await loadConfig()
	return config.settings?.[key] ?? null
}

export async function setSetting(key: string, value: string): Promise<void> {
	const config = await loadConfig()
	if (!config.settings) config.settings = {}
	config.settings[key] = value
	await saveConfig(config)
}

export async function getAllSettings(): Promise<Record<string, string>> {
	const config = await loadConfig()
	return config.settings ?? {}
}

export function generateId(): string {
	return Math.random().toString(36).substring(2, 10)
}
