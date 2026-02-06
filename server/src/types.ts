export interface EnvVar {
	key: string
	value: string
	filePath: string
}

export interface SetupStep {
	name: string
	run: string
	background?: boolean
}

export interface Repo {
	id: string
	path: string
	name: string
	envVars?: EnvVar[]
	setupSteps?: SetupStep[]
}

export interface SessionData {
	id: string
	repoId: string
	repoName: string
	worktree: string
	branch: string
	port: number
	terminalUrl: string
	pid: number
	createdAt: string
	skipPermissions?: boolean
}

export interface PushToken {
	token: string
	platform: 'ios' | 'android'
	registeredAt: string
}
