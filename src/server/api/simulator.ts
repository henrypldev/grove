import { log } from '../config'
import { emitTeamLog } from '../db/logs'

const teamDevices = new Map<string, string>()

async function findExistingDevice(
	deviceName: string,
): Promise<{ udid: string; state: string } | null> {
	const proc = Bun.spawn(['xcrun', 'simctl', 'list', 'devices', '-j'], {
		stdout: 'pipe',
		stderr: 'ignore',
	})
	const json = await new Response(proc.stdout).text()
	await proc.exited
	const { devices } = JSON.parse(json) as {
		devices: Record<
			string,
			Array<{ udid: string; name: string; state: string }>
		>
	}
	for (const runtime of Object.values(devices)) {
		for (const d of runtime) {
			if (d.name === deviceName) return { udid: d.udid, state: d.state }
		}
	}
	return null
}

async function bootIfNeeded(udid: string, state: string): Promise<void> {
	if (state === 'Booted') return
	const proc = Bun.spawn(['xcrun', 'simctl', 'boot', udid], {
		stdout: 'ignore',
		stderr: 'pipe',
		env: {
			...process.env,
			SIMCTL_CHILD_SIMULATOR_RUNTIME_ENVIRONMENT: 'standalone',
		},
	})
	await proc.exited
}

export async function createTeamDevice(teamId: string): Promise<string> {
	const deviceName = `grove-team-${teamId}`

	// Reuse existing device if one already exists for this team
	const existing = await findExistingDevice(deviceName)
	if (existing) {
		await bootIfNeeded(existing.udid, existing.state)
		teamDevices.set(teamId, existing.udid)
		log('simulator', 'reusing existing device', {
			teamId,
			udid: existing.udid,
			deviceName,
		})
		emitTeamLog(teamId, 'simulator:ready', {
			udid: existing.udid,
			name: deviceName,
		})
		return existing.udid
	}

	const runtimeProc = Bun.spawn(['xcrun', 'simctl', 'list', 'runtimes', '-j'], {
		stdout: 'pipe',
		stderr: 'ignore',
	})
	const runtimeJson = await new Response(runtimeProc.stdout).text()
	const runtimes = JSON.parse(runtimeJson).runtimes as Array<{
		identifier: string
		isAvailable: boolean
		name: string
	}>
	const iosRuntime = runtimes
		.filter(r => r.isAvailable && r.name.startsWith('iOS'))
		.pop()
	if (!iosRuntime) throw new Error('No available iOS runtime found')

	const deviceType = 'com.apple.CoreSimulator.SimDeviceType.iPhone-16'

	const createProc = Bun.spawn(
		[
			'xcrun',
			'simctl',
			'create',
			deviceName,
			deviceType,
			iosRuntime.identifier,
		],
		{ stdout: 'pipe', stderr: 'pipe' },
	)
	const udid = (await new Response(createProc.stdout).text()).trim()
	if (!udid) {
		const stderr = await new Response(createProc.stderr).text()
		throw new Error(`Failed to create simulator device: ${stderr}`)
	}

	await bootIfNeeded(udid, 'Shutdown')

	teamDevices.set(teamId, udid)
	log('simulator', 'created and booted device', { teamId, udid, deviceName })
	emitTeamLog(teamId, 'simulator:ready', { udid, name: deviceName })
	return udid
}

export async function deleteTeamDevice(teamId: string): Promise<void> {
	const udid = teamDevices.get(teamId)
	if (!udid) return

	try {
		const shutdown = Bun.spawn(['xcrun', 'simctl', 'shutdown', udid], {
			stdout: 'ignore',
			stderr: 'ignore',
		})
		await shutdown.exited
	} catch {}

	try {
		const del = Bun.spawn(['xcrun', 'simctl', 'delete', udid], {
			stdout: 'ignore',
			stderr: 'ignore',
		})
		await del.exited
	} catch {}

	teamDevices.delete(teamId)
	log('simulator', 'deleted device', { teamId, udid })
	emitTeamLog(teamId, 'simulator:deleted', { udid })
}

export function getTeamDeviceUdid(teamId: string): string | null {
	return teamDevices.get(teamId) ?? null
}

const rediscoverMissCache = new Map<string, number>()
const REDISCOVER_MISS_TTL = 30_000

/** Rediscover a team's simulator device from simctl without booting it */
export async function rediscoverTeamDevice(
	teamId: string,
): Promise<string | null> {
	if (teamDevices.has(teamId)) return teamDevices.get(teamId)!
	const lastMiss = rediscoverMissCache.get(teamId)
	if (lastMiss && Date.now() - lastMiss < REDISCOVER_MISS_TTL) return null
	const deviceName = `grove-team-${teamId}`
	const existing = await findExistingDevice(deviceName)
	if (!existing) {
		rediscoverMissCache.set(teamId, Date.now())
		return null
	}
	rediscoverMissCache.delete(teamId)
	teamDevices.set(teamId, existing.udid)
	log('simulator', 'rediscovered device', {
		teamId,
		udid: existing.udid,
		state: existing.state,
	})
	return existing.udid
}

export function hasActiveSimulators(): boolean {
	return teamDevices.size > 0
}
