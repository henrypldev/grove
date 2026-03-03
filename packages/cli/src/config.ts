import {
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface Config {
	port: number
}

const CONFIG_DIR = join(homedir(), '.config', 'grove')
const CONFIG_FILE = join(CONFIG_DIR, 'cli.json')
const PID_FILE = join(CONFIG_DIR, 'pid')

const DEFAULT_CONFIG: Config = {
	port: 3000,
}

export function loadConfig(): Config {
	if (!existsSync(CONFIG_FILE)) {
		return DEFAULT_CONFIG
	}
	try {
		const data = readFileSync(CONFIG_FILE, 'utf-8')
		return { ...DEFAULT_CONFIG, ...JSON.parse(data) }
	} catch {
		return DEFAULT_CONFIG
	}
}

export function saveConfig(config: Config): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true })
	}
	writeFileSync(CONFIG_FILE, JSON.stringify(config, null, '\t'))
}

export function savePid(pid: number): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true })
	}
	writeFileSync(PID_FILE, String(pid))
}

export function loadPid(): number | null {
	if (!existsSync(PID_FILE)) {
		return null
	}
	try {
		const data = readFileSync(PID_FILE, 'utf-8')
		return parseInt(data, 10)
	} catch {
		return null
	}
}

export function removePid(): void {
	if (existsSync(PID_FILE)) {
		unlinkSync(PID_FILE)
	}
}
