import { execSync, spawnSync } from 'node:child_process'

export interface Dependency {
	name: string
	command: string
	brewPackage: string
	isCask?: boolean
	installHint?: string
}

export const DEPENDENCIES: Dependency[] = [
	{
		name: 'claude',
		command: 'claude',
		brewPackage: 'claude-code',
		installHint: 'curl -fsSL https://claude.ai/install.sh | bash',
	},
	{
		name: 'tailscale',
		command: 'tailscale',
		brewPackage: 'tailscale',
		isCask: true,
	},
]

export function checkCommand(command: string): boolean {
	try {
		execSync(`which ${command}`, { stdio: 'ignore' })
		return true
	} catch {
		return false
	}
}

export function checkDependencies(): {
	found: Dependency[]
	missing: Dependency[]
} {
	const found: Dependency[] = []
	const missing: Dependency[] = []

	for (const dep of DEPENDENCIES) {
		if (checkCommand(dep.command)) {
			found.push(dep)
		} else {
			missing.push(dep)
		}
	}

	return { found, missing }
}

export function hasHomebrew(): boolean {
	return checkCommand('brew')
}

export function installDependency(dep: Dependency): boolean {
	try {
		const cmd = dep.isCask
			? `brew install --cask ${dep.brewPackage}`
			: `brew install ${dep.brewPackage}`
		execSync(cmd, { stdio: 'inherit' })
		return true
	} catch {
		return false
	}
}

export function isTailscaleRunning(): boolean {
	const result = spawnSync('tailscale', ['status'], { stdio: 'pipe' })
	return result.status === 0
}

export function openTailscaleApp(): void {
	execSync('open -a Tailscale')
}
