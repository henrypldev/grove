import { log } from '../config'

const teamDevices = new Map<string, string>()

export async function createTeamDevice(teamId: string): Promise<string> {
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

	const deviceName = `grove-team-${teamId}`
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

	const bootProc = Bun.spawn(['xcrun', 'simctl', 'boot', udid], {
		stdout: 'ignore',
		stderr: 'pipe',
		env: {
			...process.env,
			SIMCTL_CHILD_SIMULATOR_RUNTIME_ENVIRONMENT: 'standalone',
		},
	})
	await bootProc.exited

	teamDevices.set(teamId, udid)
	log('simulator', 'created and booted device', { teamId, udid, deviceName })
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
}

export function getTeamDeviceUdid(teamId: string): string | null {
	return teamDevices.get(teamId) ?? null
}
