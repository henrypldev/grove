import { join } from 'node:path'
import { log } from '../config'
import { emitTeamLog } from '../db/logs'
import { dbGetRepo } from '../db/repos'
import type { SetupStep } from '../types'
import { rebuildExpoBuild } from './expo-build'
import { startExpoDevServer, waitForDevServerReady } from './expo-dev-server'
import { allocatePort, setTeamPort } from './ports'

interface SetupConfig {
	setup: SetupStep[]
}

interface SetupStepState {
	name: string
	run: string
	background?: boolean
	status: 'pending' | 'running' | 'done' | 'failed' | 'stopped'
	output: string
}

interface ActiveSetup {
	teamId: string
	worktreePath: string
	repoId?: string
	port?: number
	steps: SetupStepState[]
	processes: Map<number, ReturnType<typeof Bun.spawn>>
	cancelled: boolean
}

const activeSetups = new Map<string, ActiveSetup>()

function emitProgress(
	teamId: string,
	step: number,
	name: string,
	status: string,
	output?: string,
	background?: boolean,
) {
	const payload: Record<string, unknown> = { step, name, status }
	if (output !== undefined) payload.output = output
	if (background) payload.background = true
	emitTeamLog(teamId, 'setup_progress', payload)
}

function emitOutput(teamId: string, step: number, chunk: string) {
	emitTeamLog(teamId, 'setup_output', { step, chunk })
}

async function streamOutput(
	stream: ReadableStream<Uint8Array>,
	teamId: string,
	stepIndex: number,
	onChunk: (text: string) => void,
) {
	const reader = stream.getReader()
	const decoder = new TextDecoder()
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			const text = decoder.decode(value, { stream: true })
			onChunk(text)
			emitOutput(teamId, stepIndex, text)
		}
	} finally {
		reader.releaseLock()
	}
}

function spawnStep(
	setup: ActiveSetup,
	i: number,
): ReturnType<typeof Bun.spawn> {
	const step = setup.steps[i]
	const proc = Bun.spawn(['sh', '-c', step.run], {
		cwd: setup.worktreePath,
		stdout: 'pipe',
		stderr: 'pipe',
		detached: true,
	})
	setup.processes.set(i, proc)

	const appendOutput = (text: string) => {
		step.output += text
	}

	Promise.all([
		streamOutput(proc.stdout, setup.teamId, i, appendOutput),
		streamOutput(proc.stderr, setup.teamId, i, appendOutput),
	])

	return proc
}

function monitorBackground(
	setup: ActiveSetup,
	i: number,
	proc: ReturnType<typeof Bun.spawn>,
) {
	proc.exited.then(exitCode => {
		setup.processes.delete(i)
		const step = setup.steps[i]
		if (step.status !== 'running') return

		step.output = step.output.trim()
		if (exitCode === 0) {
			step.status = 'done'
			log('setup', `background step ${i} done: ${step.name}`, {
				teamId: setup.teamId,
			})
			emitProgress(
				setup.teamId,
				i,
				step.name,
				'done',
				step.output || undefined,
				step.background,
			)
		} else {
			step.status = 'failed'
			log('setup', `background step ${i} failed: ${step.name}`, {
				teamId: setup.teamId,
				exitCode,
			})
			emitProgress(
				setup.teamId,
				i,
				step.name,
				'failed',
				step.output || undefined,
				step.background,
			)
		}
	})
}

async function runSteps(setup: ActiveSetup, fromIndex: number) {
	for (let i = fromIndex; i < setup.steps.length; i++) {
		if (setup.cancelled) return

		const step = setup.steps[i]
		step.status = 'running'
		step.output = ''
		log('setup', `step ${i} running: ${step.name}`, {
			teamId: setup.teamId,
		})
		emitProgress(
			setup.teamId,
			i,
			step.name,
			'running',
			undefined,
			step.background,
		)

		const proc = spawnStep(setup, i)

		if (step.background) {
			monitorBackground(setup, i, proc)
			continue
		}

		await proc.exited

		if (setup.cancelled) return

		setup.processes.delete(i)
		const output = step.output.trim()
		step.output = output

		if (proc.exitCode === 0) {
			step.status = 'done'
			log('setup', `step ${i} done: ${step.name}`, {
				teamId: setup.teamId,
			})
			emitProgress(setup.teamId, i, step.name, 'done', output, step.background)
		} else {
			step.status = 'failed'
			log('setup', `step ${i} failed: ${step.name}`, {
				teamId: setup.teamId,
				exitCode: proc.exitCode,
			})
			emitProgress(
				setup.teamId,
				i,
				step.name,
				'failed',
				output,
				step.background,
			)
			return
		}
	}

	if (setup.port) {
		emitTeamLog(setup.teamId, 'env:ready', { port: setup.port })
	}

	if (setup.repoId) {
		const repo = dbGetRepo(setup.repoId)
		if (repo?.needsNativeBuild) {
			try {
				if (setup.port) {
					startExpoDevServer(setup.teamId, setup.worktreePath, setup.port)
					await waitForDevServerReady(setup.teamId)
				}
				await rebuildExpoBuild(setup.teamId, setup.worktreePath)
			} catch (err) {
				log('setup', 'expo build trigger failed', {
					teamId: setup.teamId,
					err,
				})
			}
		}
	}
}

function killProcess(proc: ReturnType<typeof Bun.spawn>) {
	const pid = proc.pid
	try {
		process.kill(-pid, 'SIGTERM')
	} catch {
		try {
			proc.kill()
		} catch {}
	}
}

export async function startTeamSetup(
	teamId: string,
	worktreePath: string,
	repoSetupSteps?: SetupStep[],
	repoId?: string,
) {
	const configPath = join(worktreePath, '.grove', 'setup.json')
	const file = Bun.file(configPath)

	let steps: SetupStep[] | undefined

	if (await file.exists()) {
		try {
			const config: SetupConfig = await file.json()
			if (config.setup && Array.isArray(config.setup)) {
				steps = config.setup
				log('setup', 'using .grove/setup.json', { teamId })
			}
		} catch {
			log('setup', 'invalid setup.json', { teamId, path: configPath })
		}
	}

	if (!steps && repoSetupSteps && repoSetupSteps.length > 0) {
		steps = repoSetupSteps
		log('setup', 'using db setup steps', { teamId })
	}

	if (!steps || steps.length === 0) {
		// No setup steps, but still trigger expo build if needed
		if (repoId) {
			const repo = dbGetRepo(repoId)
			if (repo?.needsNativeBuild) {
				const port = (await allocatePort()) ?? null
				if (port) {
					setTeamPort(teamId, port)
					startExpoDevServer(teamId, worktreePath, port)
					await waitForDevServerReady(teamId)
				}
				rebuildExpoBuild(teamId, worktreePath).catch(err => {
					log('setup', 'expo build trigger failed', { teamId, err })
				})
			}
		}
		return
	}

	const needsPort = steps.some(s => s.run.includes('{{PORT}}'))
	let port: number | undefined
	if (needsPort) {
		port = (await allocatePort()) ?? undefined
		if (port) {
			setTeamPort(teamId, port)
			log('setup', 'allocated port', { teamId, port })
		}
	}

	const setup: ActiveSetup = {
		teamId,
		worktreePath,
		repoId,
		port,
		steps: steps.map(s => ({
			name: s.name,
			run: port ? s.run.replaceAll('{{PORT}}', String(port)) : s.run,
			background: s.background,
			status: 'pending',
			output: '',
		})),
		processes: new Map(),
		cancelled: false,
	}

	activeSetups.set(teamId, setup)
	log('setup', 'starting setup', { teamId, steps: setup.steps.length })

	runSteps(setup, 0)
}

export async function retryTeamSetup(
	teamId: string,
	worktreePath: string,
	repoSetupSteps?: SetupStep[],
	repoId?: string,
) {
	cleanupTeamSetup(teamId)
	return startTeamSetup(teamId, worktreePath, repoSetupSteps, repoId)
}

export function cancelTeamSetup(teamId: string) {
	log('setup', 'cancelTeamSetup called', {
		teamId,
		hasSetup: activeSetups.has(teamId),
	})
	const setup = activeSetups.get(teamId)
	if (!setup) return

	setup.cancelled = true

	for (const [stepIndex, proc] of setup.processes) {
		log('setup', 'killing process', { teamId, stepIndex, pid: proc.pid })
		killProcess(proc)
	}
	setup.processes.clear()

	for (let i = 0; i < setup.steps.length; i++) {
		const step = setup.steps[i]
		if (step.status === 'running') {
			step.status = 'stopped'
			emitProgress(
				teamId,
				i,
				step.name,
				'stopped',
				step.output || undefined,
				step.background,
			)
		}
	}

	log('setup', 'cancelled setup', { teamId })
}

export function stopTeamStep(teamId: string, stepIndex: number): string | null {
	const setup = activeSetups.get(teamId)
	if (!setup) return 'Setup not found'

	const step = setup.steps[stepIndex]
	if (!step) return 'Invalid step index'
	if (step.status !== 'running') return 'Step is not running'

	const proc = setup.processes.get(stepIndex)
	if (proc) {
		killProcess(proc)
		setup.processes.delete(stepIndex)
	}

	step.status = 'stopped'
	log('setup', `step ${stepIndex} stopped: ${step.name}`, { teamId })
	emitProgress(
		teamId,
		stepIndex,
		step.name,
		'stopped',
		step.output || undefined,
		step.background,
	)
	return null
}

export function startTeamStep(
	teamId: string,
	stepIndex: number,
): string | null {
	const setup = activeSetups.get(teamId)
	if (!setup) return 'Setup not found'

	const step = setup.steps[stepIndex]
	if (!step) return 'Invalid step index'
	if (step.status !== 'stopped' && step.status !== 'failed')
		return 'Step is not stopped or failed'

	step.status = 'running'
	step.output = ''
	log('setup', `step ${stepIndex} restarting: ${step.name}`, { teamId })
	emitProgress(
		teamId,
		stepIndex,
		step.name,
		'running',
		undefined,
		step.background,
	)

	const proc = spawnStep(setup, stepIndex)
	monitorBackground(setup, stepIndex, proc)
	return null
}

export function getTeamSetupLogs(
	teamId: string,
): Array<{ name: string; status: string; output: string }> | null {
	const setup = activeSetups.get(teamId)
	if (!setup) return null
	return setup.steps.map(s => ({
		name: s.name,
		status: s.status,
		output: s.output,
	}))
}

export function cleanupTeamSetup(teamId: string) {
	cancelTeamSetup(teamId)
	activeSetups.delete(teamId)
}
