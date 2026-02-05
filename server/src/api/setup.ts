import { join } from 'node:path'
import { log } from '../config'
import { broadcastSSE } from './sessions'

interface SetupConfig {
	setup: { name: string; run: string }[]
}

interface SetupStepState {
	name: string
	run: string
	status: 'pending' | 'running' | 'done' | 'failed'
	output: string
}

interface ActiveSetup {
	sessionId: string
	worktreePath: string
	steps: SetupStepState[]
	currentProcess: ReturnType<typeof Bun.spawn> | null
	cancelled: boolean
}

const activeSetups = new Map<string, ActiveSetup>()

function broadcastStep(sessionId: string, step: number, name: string, status: string, output?: string) {
	const event: Record<string, unknown> = { type: 'setup_progress', sessionId, step, name, status }
	if (output !== undefined) event.output = output
	broadcastSSE(`data: ${JSON.stringify(event)}\n\n`)
}

async function runSteps(setup: ActiveSetup, fromIndex: number) {
	for (let i = fromIndex; i < setup.steps.length; i++) {
		if (setup.cancelled) return

		const step = setup.steps[i]
		step.status = 'running'
		log('setup', `step ${i} running: ${step.name}`, { sessionId: setup.sessionId })
		broadcastStep(setup.sessionId, i, step.name, 'running')

		const proc = Bun.spawn(['sh', '-c', step.run], {
			cwd: setup.worktreePath,
			stdout: 'pipe',
			stderr: 'pipe',
			detached: true,
		})
		setup.currentProcess = proc

		await proc.exited

		if (setup.cancelled) return

		const stdout = await new Response(proc.stdout).text()
		const stderr = await new Response(proc.stderr).text()
		const output = (stdout + stderr).trim()

		setup.currentProcess = null

		if (proc.exitCode === 0) {
			step.status = 'done'
			step.output = output
			log('setup', `step ${i} done: ${step.name}`, { sessionId: setup.sessionId })
			broadcastStep(setup.sessionId, i, step.name, 'done', output)
		} else {
			step.status = 'failed'
			step.output = output
			log('setup', `step ${i} failed: ${step.name}`, { sessionId: setup.sessionId, exitCode: proc.exitCode })
			broadcastStep(setup.sessionId, i, step.name, 'failed', output)
			return
		}
	}
}

export async function startSetup(sessionId: string, worktreePath: string) {
	const configPath = join(worktreePath, '.grove', 'setup.json')
	const file = Bun.file(configPath)

	if (!(await file.exists())) return

	let config: SetupConfig
	try {
		config = await file.json()
	} catch {
		log('setup', 'invalid setup.json', { sessionId, path: configPath })
		return
	}

	if (!config.setup || !Array.isArray(config.setup)) {
		log('setup', 'invalid setup config format', { sessionId })
		return
	}

	const setup: ActiveSetup = {
		sessionId,
		worktreePath,
		steps: config.setup.map(s => ({
			name: s.name,
			run: s.run,
			status: 'pending',
			output: '',
		})),
		currentProcess: null,
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

export function cancelSetup(sessionId: string) {
	log('setup', 'cancelSetup called', { sessionId, hasSetup: activeSetups.has(sessionId) })
	const setup = activeSetups.get(sessionId)
	if (!setup) return

	setup.cancelled = true
	if (setup.currentProcess) {
		const pid = setup.currentProcess.pid
		log('setup', 'killing process group', { sessionId, pid })
		try {
			process.kill(-pid, 'SIGTERM')
		} catch (err) {
			log('setup', 'process group kill failed, falling back', { sessionId, pid, error: String(err) })
			setup.currentProcess.kill()
		}
	} else {
		log('setup', 'no currentProcess to kill', { sessionId })
	}

	const runningIndex = setup.steps.findIndex((s) => s.status === 'running')
	if (runningIndex !== -1) {
		const step = setup.steps[runningIndex]
		step.status = 'failed'
		step.output = 'Cancelled'
		broadcastStep(sessionId, runningIndex, step.name, 'failed', 'Cancelled')
	}

	setup.currentProcess = null
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

export function broadcastAllSetupStates() {
	for (const [sessionId, setup] of activeSetups) {
		for (let i = 0; i < setup.steps.length; i++) {
			const step = setup.steps[i]
			if (step.status === 'pending') continue
			broadcastStep(sessionId, i, step.name, step.status, step.output || undefined)
		}
	}
}
