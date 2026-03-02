import { log } from '../config'
import { dbInsertLog } from '../db/logs'
import type { Script } from '../types'
import { getTeamPort } from './ports'

interface ActiveScript {
	teamId: string
	scriptId: string
	name: string
	worktreePath: string
	process: ReturnType<typeof Bun.spawn>
	output: string
	background: boolean
}

const activeScripts = new Map<string, ActiveScript>()

function emitProgress(
	teamId: string,
	scriptId: string,
	name: string,
	status: string,
	output?: string,
) {
	dbInsertLog(teamId, 'script_progress', {
		scriptId,
		name,
		status,
		...(output !== undefined ? { output } : {}),
	})
}

function emitOutput(teamId: string, scriptId: string, chunk: string) {
	dbInsertLog(teamId, 'script_output', { scriptId, chunk })
}

async function streamOutput(
	stream: ReadableStream<Uint8Array>,
	active: ActiveScript,
) {
	const reader = stream.getReader()
	const decoder = new TextDecoder()
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			const text = decoder.decode(value, { stream: true })
			active.output += text
			emitOutput(active.teamId, active.scriptId, text)
		}
	} finally {
		reader.releaseLock()
	}
}

export function getActiveScript(teamId: string): ActiveScript | undefined {
	return activeScripts.get(teamId)
}

export async function runScript(
	teamId: string,
	worktreePath: string,
	script: Script,
): Promise<string | null> {
	if (activeScripts.has(teamId)) {
		return 'A script is already running for this team'
	}

	let command = script.run
	if (command.includes('{{PORT}}')) {
		const port = getTeamPort(teamId)
		if (port) {
			command = command.replaceAll('{{PORT}}', String(port))
		}
	}

	const proc = Bun.spawn(['sh', '-c', command], {
		cwd: worktreePath,
		stdout: 'pipe',
		stderr: 'pipe',
		detached: true,
	})

	const active: ActiveScript = {
		teamId,
		scriptId: script.id,
		name: script.name,
		worktreePath,
		process: proc,
		output: '',
		background: script.background ?? false,
	}

	activeScripts.set(teamId, active)
	log('scripts', `running: ${script.name}`, { teamId, scriptId: script.id })
	emitProgress(teamId, script.id, script.name, 'running')

	Promise.all([
		streamOutput(proc.stdout, active),
		streamOutput(proc.stderr, active),
	])

	proc.exited.then(exitCode => {
		if (!activeScripts.has(teamId)) return
		activeScripts.delete(teamId)

		const output = active.output.trim()
		const status = exitCode === 0 ? 'done' : 'failed'
		log('scripts', `${status}: ${script.name}`, {
			teamId,
			scriptId: script.id,
			exitCode,
		})
		emitProgress(teamId, script.id, script.name, status, output || undefined)
	})

	return null
}

export function stopScript(teamId: string): string | null {
	const active = activeScripts.get(teamId)
	if (!active) return 'No script running for this team'

	const pid = active.process.pid
	try {
		process.kill(-pid, 'SIGTERM')
	} catch {
		try {
			active.process.kill()
		} catch {}
	}

	activeScripts.delete(teamId)
	log('scripts', `stopped: ${active.name}`, { teamId })
	emitProgress(
		teamId,
		active.scriptId,
		active.name,
		'stopped',
		active.output.trim() || undefined,
	)
	return null
}
