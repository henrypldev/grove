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
	fingerprint?: string
	needsNativeBuild?: boolean
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

export type TeamStatus =
	| 'planning'
	| 'active'
	| 'blocked'
	| 'review'
	| 'idle'
	| 'done'
	| 'archived'
export type AgentRole =
	| 'orchestrator'
	| 'pm'
	| 'team-lead'
	| 'dev'
	| 'qa'
	| 'reviewer'
export type AgentStatus =
	| 'idle'
	| 'planning'
	| 'working'
	| 'blocked'
	| 'done'
	| 'error'

export interface Team {
	id: string
	repoId: string
	worktreePath: string
	task: string
	title: string | null
	status: TeamStatus
	pmSummary: string | null
	port: number | null
	prUrl: string | null
	createdAt: number
	updatedAt: number
}

export interface Agent {
	id: string
	teamId: string
	role: AgentRole
	status: AgentStatus
	activity: string | null
	currentTask: string | null
	sessionId: string | null
	retryCount: number
	spawnedAt: number
	updatedAt: number
}

export interface ToolCall {
	name: string
	input: unknown
	output?: unknown
	error?: string
}

export interface AgentMessagePayload {
	text: string
	tools: ToolCall[]
}

export interface TeamEvent {
	id: number
	teamId: string
	agentId: string | null
	type: string
	payload: string
	createdAt: number
}

export interface PmReport {
	id: number
	teamId: string
	summary: string
	createdAt: number
}

export type WsClientMessage =
	| { type: 'auth'; payload: { deviceType: 'mac' | 'mobile' } }
	| { type: 'subscribe'; channels: string[] }
	| { type: 'unsubscribe'; channels: string[] }
	| { type: 'replay'; channel: string; sinceId: number }
	| { type: 'ping' }

export type WsServerMessage =
	| { type: 'event'; channel: string; data: TeamEvent }
	| {
			type: 'team:update'
			channel: 'global'
			data: Partial<Team> & { id: string }
	  }
	| {
			type: 'agent:update'
			channel: string
			data: Partial<Agent> & { id: string; teamId: string }
	  }
	| { type: 'replay:batch'; channel: string; events: TeamEvent[] }
	| { type: 'connected' }
	| { type: 'pong' }
