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

export function startFunnel(port: number): boolean {
	try {
		execSync(`tailscale funnel --bg --set-path /grove localhost:${port}`, {
			stdio: 'inherit',
		})
		return true
	} catch {
		return false
	}
}

export function stopFunnel(): void {
	try {
		spawnSync('tailscale', ['funnel', '--set-path', '/grove', 'off'], {
			stdio: 'ignore',
		})
	} catch {
		// Ignore errors on cleanup
	}
}

export function isFunnelEnabled(): boolean {
	try {
		const result = execSync('tailscale funnel status', { encoding: 'utf-8' })
		return result.includes('/grove')
	} catch {
		return false
	}
}
