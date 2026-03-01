import { log } from '../config'
import { dbInsertLog } from '../db/logs'
import { dbGetRepo, dbUpdateRepoFingerprint } from '../db/repos'
import { allocatePort, getTeamPort, setTeamPort } from './ports'
import { createTeamDevice, getTeamDeviceUdid } from './simulator'

type ExpoBuildStatus = 'building' | 'done' | 'failed' | 'stopped'

interface ActiveExpoBuild {
	teamId: string
	worktreePath: string
	process: ReturnType<typeof Bun.spawn> | null
	output: string
	status: ExpoBuildStatus
}

const activeBuilds = new Map<string, ActiveExpoBuild>()

function emitOutput(teamId: string, chunk: string) {
	dbInsertLog(teamId, 'expo_build_output', { chunk })
}

function emitProgress(teamId: string, status: string) {
	dbInsertLog(teamId, 'expo_build', { status })
}

async function streamOutput(
	stream: ReadableStream<Uint8Array>,
	build: ActiveExpoBuild,
) {
	const reader = stream.getReader()
	const decoder = new TextDecoder()
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			const text = decoder.decode(value, { stream: true })
			build.output += text
			emitOutput(build.teamId, text)
		}
	} finally {
		reader.releaseLock()
	}
}

const HEADLESS_MARKER = '// GROVE_HEADLESS'

async function patchExpoHeadless(worktreePath: string) {
	const iosDir = `${worktreePath}/node_modules/@expo/cli/build/src/start/platforms/ios`

	// 1. ensureSimulatorAppRunningAsync — skip the osascript check + open -a Simulator
	await patchFile(
		`${iosDir}/ensureSimulatorAppRunning.js`,
		/async function ensureSimulatorAppRunningAsync\(device, \{ maxWaitTime \} = \{\}\) \{/,
		`async function ensureSimulatorAppRunningAsync(device, { maxWaitTime } = {}) {\n    if (process.env.GROVE_HEADLESS) return; ${HEADLESS_MARKER}`,
	)

	// 2. activateWindowAsync — skip `tell application "Simulator" to activate`
	await patchFile(
		`${iosDir}/AppleDeviceManager.js`,
		/async activateWindowAsync\(\) \{/,
		`async activateWindowAsync() {\n        if (process.env.GROVE_HEADLESS) return; ${HEADLESS_MARKER}`,
	)

	// 3. ensureSimulatorOpenAsync — skip the waitForAction timeout loop,
	//    just boot and return the device directly
	await patchFile(
		`${iosDir}/AppleDeviceManager.js`,
		/async function ensureSimulatorOpenAsync\(\{ udid, osType \} = \{\}, tryAgain = true\) \{/,
		`async function ensureSimulatorOpenAsync({ udid, osType } = {}, tryAgain = true) {\n    if (process.env.GROVE_HEADLESS && udid) { await _simctl.bootAsync({ udid }).catch(() => {}); const d = await _simctl.isDeviceBootedAsync({ udid }); if (d) return d; } ${HEADLESS_MARKER}`,
	)
}

async function patchFile(
	filePath: string,
	pattern: RegExp,
	replacement: string,
) {
	try {
		const src = await Bun.file(filePath).text()
		if (src.includes(HEADLESS_MARKER)) return
		const patched = src.replace(pattern, replacement)
		if (patched !== src) {
			await Bun.write(filePath, patched)
			log('expo', `patched ${filePath.split('/').pop()}`)
		}
	} catch (err) {
		log('expo', `failed to patch ${filePath}`, { err })
	}
}

export async function startExpoBuild(
	teamId: string,
	worktreePath: string,
	deviceUdid: string,
	port: number,
) {
	if (activeBuilds.has(teamId)) {
		log('expo', 'build already running', { teamId })
		return
	}

	// Patch Expo to skip opening Simulator.app GUI.
	// The device is already booted headlessly via simctl.
	await patchExpoHeadless(worktreePath)

	const command = `bunx expo run:ios --device ${deviceUdid} --port ${port}`
	const proc = Bun.spawn(['sh', '-c', command], {
		cwd: worktreePath,
		stdout: 'pipe',
		stderr: 'pipe',
		detached: true,
		env: {
			...process.env,
			GROVE_HEADLESS: '1',
		},
	})

	const build: ActiveExpoBuild = {
		teamId,
		worktreePath,
		process: proc,
		output: '',
		status: 'building',
	}

	activeBuilds.set(teamId, build)
	log('expo', 'build started', { teamId, deviceUdid, port })
	emitProgress(teamId, 'building')

	Promise.all([
		streamOutput(proc.stdout, build),
		streamOutput(proc.stderr, build),
	])

	proc.exited.then(exitCode => {
		const b = activeBuilds.get(teamId)
		if (!b || b.status !== 'building') return

		b.process = null
		b.status = exitCode === 0 ? 'done' : 'failed'
		log('expo', `build ${b.status}`, { teamId, exitCode })
		emitProgress(teamId, b.status)
	})
}

export function stopExpoBuild(teamId: string) {
	const build = activeBuilds.get(teamId)
	if (!build) return

	if (build.process) {
		const pid = build.process.pid
		try {
			process.kill(-pid, 'SIGTERM')
		} catch {
			try {
				build.process.kill()
			} catch {}
		}
	}

	emitProgress(teamId, 'stopped')
	activeBuilds.delete(teamId)
	log('expo', 'build stopped', { teamId })
}

export function getExpoBuildStatus(teamId: string): ExpoBuildStatus | null {
	return activeBuilds.get(teamId)?.status ?? null
}

export function getExpoBuildOutput(teamId: string): string | null {
	return activeBuilds.get(teamId)?.output ?? null
}

export async function rebuildExpoBuild(
	teamId: string,
	worktreePath: string,
): Promise<void> {
	stopExpoBuild(teamId)

	const udid = getTeamDeviceUdid(teamId) ?? (await createTeamDevice(teamId))

	let port = getTeamPort(teamId)
	if (!port) {
		port = (await allocatePort()) ?? null
		if (port) setTeamPort(teamId, port)
	}

	if (!port) {
		log('expo', 'no port available for rebuild', { teamId })
		return
	}

	startExpoBuild(teamId, worktreePath, udid, port)
	dbInsertLog(teamId, 'simulator:device_created', {
		udid,
		name: `grove-team-${teamId}`,
		port,
	})
}

export async function checkFingerprintAndRebuild(
	teamId: string,
	worktreePath: string,
	repoId: string,
): Promise<boolean> {
	try {
		const proc = Bun.spawn(['sh', '-c', 'npx @expo/fingerprint --json'], {
			cwd: worktreePath,
			stdout: 'pipe',
			stderr: 'ignore',
		})
		const output = await new Response(proc.stdout).text()
		await proc.exited
		if (proc.exitCode !== 0) return false

		const result = JSON.parse(output)
		const newHash = result.hash as string
		if (!newHash) return false

		const repo = dbGetRepo(repoId)
		if (repo?.fingerprint === newHash) return false

		log('expo', 'fingerprint changed, triggering rebuild', {
			teamId,
			oldHash: repo?.fingerprint,
			newHash,
		})

		dbUpdateRepoFingerprint(repoId, newHash)
		await rebuildExpoBuild(teamId, worktreePath)
		return true
	} catch (err) {
		log('expo', 'fingerprint check failed', { teamId, err })
		return false
	}
}
