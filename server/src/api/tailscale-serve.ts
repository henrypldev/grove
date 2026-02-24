import { log } from '../config'

export function registerTeamServe(teamId: string, port: number) {
	const path = `/dev-${teamId}`
	const target = `http://localhost:${port}`
	Bun.spawn(['tailscale', 'serve', '--bg', `--set-path=${path}`, target], {
		stdout: 'ignore',
		stderr: 'pipe',
	})
		.exited.then(code => {
			if (code === 0) {
				log('tailscale-serve', `registered ${path} -> ${target}`)
			} else {
				log('tailscale-serve', `failed to register ${path}`, { code })
			}
		})
		.catch(err => {
			log('tailscale-serve', `error registering ${path}`, { err })
		})
}

export function unregisterTeamServe(teamId: string) {
	const path = `/dev-${teamId}`
	Bun.spawn(['tailscale', 'serve', `--set-path=${path}`, 'off'], {
		stdout: 'ignore',
		stderr: 'pipe',
	})
		.exited.then(code => {
			if (code === 0) {
				log('tailscale-serve', `unregistered ${path}`)
			} else {
				log('tailscale-serve', `failed to unregister ${path}`, { code })
			}
		})
		.catch(err => {
			log('tailscale-serve', `error unregistering ${path}`, { err })
		})
}
