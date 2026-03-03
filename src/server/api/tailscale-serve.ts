import { log } from '../config'

export function registerTeamServe(teamId: string, port: number) {
	const target = `http://localhost:${port}`
	Bun.spawn(['tailscale', 'serve', '--bg', '--https', String(port), target], {
		stdout: 'ignore',
		stderr: 'pipe',
	})
		.exited.then(code => {
			if (code === 0) {
				log('tailscale-serve', `registered :${port} -> ${target}`, {
					teamId,
				})
			} else {
				log('tailscale-serve', `failed to register :${port}`, {
					teamId,
					code,
				})
			}
		})
		.catch(err => {
			log('tailscale-serve', `error registering :${port}`, { teamId, err })
		})
}

export function unregisterTeamServe(teamId: string, port: number) {
	Bun.spawn(['tailscale', 'serve', '--https', String(port), 'off'], {
		stdout: 'ignore',
		stderr: 'pipe',
	})
		.exited.then(code => {
			if (code === 0) {
				log('tailscale-serve', `unregistered :${port}`, { teamId })
			} else {
				log('tailscale-serve', `failed to unregister :${port}`, {
					teamId,
					code,
				})
			}
		})
		.catch(err => {
			log('tailscale-serve', `error unregistering :${port}`, {
				teamId,
				err,
			})
		})
}
