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

export type TeamStatus =
	| 'planning'
	| 'active'
	| 'blocked'
	| 'review'
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
	status: TeamStatus
	pmSummary: string | null
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
	agentId: string
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
	| { type: 'subscribe'; payload: { teamIds: string[] } }
	| { type: 'replay'; payload: { teamId: string; since: number } }

export type WsServerMessage =
	| {
			type: 'agent:event'
			teamId: string
			agentId: string
			role: AgentRole
			event: Record<string, unknown>
	  }
	| {
			type: 'agent:status'
			teamId: string
			agentId: string
			status: AgentStatus
	  }
	| { type: 'pm:report'; teamId: string; summary: string }
	| { type: 'team:status'; teamId: string; status: TeamStatus }
	| { type: 'team:spawned'; team: Team }
	| { type: 'replay:batch'; events: TeamEvent[] }
	| { type: 'connected' }
	| { type: 'heartbeat' }
