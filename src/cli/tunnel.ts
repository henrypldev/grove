import { execSync, spawnSync } from 'node:child_process'

export interface TailscaleStatus {
	Self: {
		DNSName: string
		TailscaleIPs: string[]
	}
}

export interface TailscaleInfo {
	hostname: string
	ip: string
}

export function getTailscaleInfo(): TailscaleInfo | null {
	try {
		const result = execSync('tailscale status --json', { encoding: 'utf-8' })
		const status: TailscaleStatus = JSON.parse(result)
		const dnsName = status.Self.DNSName
		const hostname = dnsName.endsWith('.') ? dnsName.slice(0, -1) : dnsName
		const ip = status.Self.TailscaleIPs[0]
		return { hostname, ip }
	} catch {
		return null
	}
}

export const SERVE_PATH =
	process.env.GROVE_ENV === 'development' ? '/grove-dev' : '/grove'

export function startServe(port: number): boolean {
	try {
		execSync(
			`tailscale serve --bg --set-path ${SERVE_PATH} localhost:${port}`,
			{
				stdio: 'inherit',
			},
		)
		return true
	} catch {
		return false
	}
}

export function stopServe(): void {
	try {
		spawnSync('tailscale', ['serve', '--set-path', SERVE_PATH, 'off'], {
			stdio: 'ignore',
		})
	} catch {
		// Ignore errors on cleanup
	}
}

export function isServeEnabled(): boolean {
	try {
		const result = execSync('tailscale serve status', { encoding: 'utf-8' })
		return result.includes(SERVE_PATH)
	} catch {
		return false
	}
}
