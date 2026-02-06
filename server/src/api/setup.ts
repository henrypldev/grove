import { join } from 'node:path'
import { log, type SetupStep } from '../config'
import { broadcastSSE } from './sessions'

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
	sessionId: string
	worktreePath: string
	steps: SetupStepState[]
	processes: Map<number, ReturnType<typeof Bun.spawn>>
	cancelled: boolean
}

const activeSetups = new Map<string, ActiveSetup>()

function broadcastStep(
	sessionId: string,
	step: number,
	name: string,
	status: string,
	output?: string,
	background?: boolean,
) {
	const event: Record<string, unknown> = {
		type: 'setup_progress',
		sessionId,
		step,
		name,
		status,
	}
	if (output !== undefined) event.output = output
	if (background) event.background = true
	broadcastSSE(`data: ${JSON.stringify(event)}\n\n`)
}

function broadcastOutput(sessionId: string, step: number, chunk: string) {
	const event = { type: 'setup_output', sessionId, step, chunk }
	broadcastSSE(`data: ${JSON.stringify(event)}\n\n`)
}

async function streamOutput(
	stream: ReadableStream<Uint8Array>,
	sessionId: string,
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
			broadcastOutput(sessionId, stepIndex, text)
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
		streamOutput(proc.stdout, setup.sessionId, i, appendOutput),
		streamOutput(proc.stderr, setup.sessionId, i, appendOutput),
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
				sessionId: setup.sessionId,
			})
			broadcastStep(
				setup.sessionId,
				i,
				step.name,
				'done',
				step.output || undefined,
				step.background,
			)
		} else {
			step.status = 'failed'
			log('setup', `background step ${i} failed: ${step.name}`, {
				sessionId: setup.sessionId,
				exitCode,
			})
			broadcastStep(
				setup.sessionId,
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
			sessionId: setup.sessionId,
		})
		broadcastStep(
			setup.sessionId,
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
				sessionId: setup.sessionId,
			})
			broadcastStep(
				setup.sessionId,
				i,
				step.name,
				'done',
				output,
				step.background,
			)
		} else {
			step.status = 'failed'
			log('setup', `step ${i} failed: ${step.name}`, {
				sessionId: setup.sessionId,
				exitCode: proc.exitCode,
			})
			broadcastStep(
				setup.sessionId,
				i,
				step.name,
				'failed',
				output,
				step.background,
			)
			return
		}
	}
}

export async function startSetup(
	sessionId: string,
	worktreePath: string,
	repoSetupSteps?: SetupStep[],
) {
	const configPath = join(worktreePath, '.grove', 'setup.json')
	const file = Bun.file(configPath)

	let steps: SetupStep[] | undefined

	if (await file.exists()) {
		try {
			const config: SetupConfig = await file.json()
			if (config.setup && Array.isArray(config.setup)) {
				steps = config.setup
				log('setup', 'using .grove/setup.json', { sessionId })
			}
		} catch {
			log('setup', 'invalid setup.json', { sessionId, path: configPath })
		}
	}

	if (!steps && repoSetupSteps && repoSetupSteps.length > 0) {
		steps = repoSetupSteps
		log('setup', 'using config.json setup steps', { sessionId })
	}

	if (!steps || steps.length === 0) return

	const setup: ActiveSetup = {
		sessionId,
		worktreePath,
		steps: steps.map(s => ({
			name: s.name,
			run: s.run,
			background: s.background,
			status: 'pending',
			output: '',
		})),
		processes: new Map(),
		cancelled: false,
	}

	activeSetups.set(sessionId, setup)
	log('setup', 'starting setup', { sessionId, steps: setup.steps.length })

	runSteps(setup, 0)
}

export async function retrySetup(sessionId: string) {
	const setup = activeSetups.get(sessionId)
	if (!setup) return

	const failedIndex = setup.steps.findIndex(s => s.status === 'failed')
	if (failedIndex === -1) return

	for (let i = failedIndex; i < setup.steps.length; i++) {
		setup.steps[i].status = 'pending'
		setup.steps[i].output = ''
	}

	setup.cancelled = false
	log('setup', 'retrying setup', { sessionId, fromStep: failedIndex })

	runSteps(setup, failedIndex)
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

export function cancelSetup(sessionId: string) {
	log('setup', 'cancelSetup called', {
		sessionId,
		hasSetup: activeSetups.has(sessionId),
	})
	const setup = activeSetups.get(sessionId)
	if (!setup) return

	setup.cancelled = true

	for (const [stepIndex, proc] of setup.processes) {
		log('setup', 'killing process', { sessionId, stepIndex, pid: proc.pid })
		killProcess(proc)
	}
	setup.processes.clear()

	for (let i = 0; i < setup.steps.length; i++) {
		const step = setup.steps[i]
		if (step.status === 'running') {
			step.status = 'stopped'
			broadcastStep(
				sessionId,
				i,
				step.name,
				'stopped',
				step.output || undefined,
				step.background,
			)
		}
	}

	log('setup', 'cancelled setup', { sessionId })
}

export function cleanupSetup(sessionId: string) {
	cancelSetup(sessionId)
	activeSetups.delete(sessionId)
}

export function getSetupState(sessionId: string): SetupStepState[] | null {
	const setup = activeSetups.get(sessionId)
	if (!setup) return null
	return setup.steps
}

export function stopStep(sessionId: string, stepIndex: number): string | null {
	const setup = activeSetups.get(sessionId)
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
	log('setup', `step ${stepIndex} stopped: ${step.name}`, { sessionId })
	broadcastStep(
		sessionId,
		stepIndex,
		step.name,
		'stopped',
		step.output || undefined,
		step.background,
	)
	return null
}

export function startStep(sessionId: string, stepIndex: number): string | null {
	const setup = activeSetups.get(sessionId)
	if (!setup) return 'Setup not found'

	const step = setup.steps[stepIndex]
	if (!step) return 'Invalid step index'
	if (step.status !== 'stopped' && step.status !== 'failed')
		return 'Step is not stopped or failed'

	step.status = 'running'
	step.output = ''
	log('setup', `step ${stepIndex} restarting: ${step.name}`, { sessionId })
	broadcastStep(
		sessionId,
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

export function broadcastAllSetupStates() {
	for (const [sessionId, setup] of activeSetups) {
		for (let i = 0; i < setup.steps.length; i++) {
			const step = setup.steps[i]
			if (step.status === 'pending') continue
			broadcastStep(
				sessionId,
				i,
				step.name,
				step.status,
				step.output || undefined,
				step.background,
			)
		}
	}
}
