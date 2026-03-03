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

export interface Script {
	id: string
	repoId: string
	name: string
	run: string
	background?: boolean
	createdAt: number
}

export interface Repo {
	id: string
	path: string
	name: string
	framework?: string
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
	| 'env'
export type SpawnableRole = Exclude<AgentRole, 'orchestrator' | 'pm'>
export type AgentStatus =
	| 'idle'
	| 'planning'
	| 'working'
	| 'waiting'
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

export interface TeamActivity {
	id: number
	teamId: string
	agentId: string | null
	type: string
	payload: string
	createdAt: number
}

export interface TeamLog {
	id: number
	teamId: string
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

export interface TeamDependency {
	teamId: string
	dependsOnTeamId: string
}

// --- Response types (shared between server and SDK) ---

export interface TeamDetail extends Team {
	port: number | null
	devUrl: string | null
	agents: Agent[]
	simulatorUdid: string | null
	simulatorDeviceName: string | null
	expoBuildStatus: string | null
	expoDevServerStatus: string | null
	devServerStatus: string | null
}

export interface AgentTask {
	idString: string
	title: string
	priority: string
	status: string
	blockedBy: string[]
}

export interface SetupLogEntry {
	step: number
	name: string
	status: string
	output: string
}

export interface DashboardTeam {
	id: string
	title: string | null
	status: string
	repoId: string
	port: number | null
	agents: Array<{
		id: string
		role: string
		status: string
		activity: string | null
	}>
	env: Record<string, unknown> | null
	behindMain: number
	lastCommit: string
}

export interface DashboardResult {
	teams: DashboardTeam[]
	metrics: Record<string, unknown>
}

export interface UsageResult {
	totalInputTokens: number
	totalOutputTokens: number
	totalCacheReadTokens: number
	totalCacheCreationTokens: number
	totalNumTurns: number
	avgDurationMs: number
	avgDurationApiMs: number
	byModel: Record<
		string,
		{ inputTokens: number; outputTokens: number; costUsd: number }
	>
	byDay: Record<
		string,
		{
			inputTokens: number
			outputTokens: number
			cacheReadTokens: number
			cacheCreationTokens: number
			numTurns: number
		}
	>
}

export type WsClientMessage =
	| { type: 'auth'; payload: { deviceType: 'mac' | 'mobile' } }
	| { type: 'subscribe'; channels: string[] }
	| { type: 'unsubscribe'; channels: string[] }
	| { type: 'replay'; channel: string; sinceId: number }
	| { type: 'ping' }
	| {
			type: 'rpc'
			id: string
			method: string
			params?: Record<string, unknown>
	  }

export type WsServerMessage =
	| { type: 'activity'; channel: string; data: TeamActivity }
	| { type: 'log'; channel: string; data: TeamLog }
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
	| { type: 'replay:batch'; channel: string; activity: TeamActivity[] }
	| { type: 'connected' }
	| { type: 'pong' }
	| { type: 'rpc:response'; id: string; data?: unknown; error?: string }
