import type {
	Agent,
	AgentRole,
	Repo,
	Script,
	SetupStep,
	Team,
	TeamActivity,
	TeamLog,
} from '@usegrove/shared'

// Spawnable roles (subset of AgentRole)
export type SpawnableRole = 'team-lead' | 'dev' | 'qa' | 'reviewer' | 'env'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface GroveClientOptions {
	url: string
	deviceType?: 'mac' | 'mobile'
	autoReconnect?: boolean
	reconnectMaxRetries?: number
	reconnectBaseDelay?: number
	pingInterval?: number
	rpcTimeout?: number
}

// RPC method type map — every method, its params, and return type
export interface RpcMethods {
	// Config & version
	version: { params: {}; result: { version: string } }
	'config:settings:get': { params: {}; result: Record<string, string> }
	'config:settings:update': {
		params: { settings: Record<string, string> }
		result: Record<string, string>
	}
	'config:clone-dir:get': { params: {}; result: { cloneDirectory: string } }
	'config:clone-dir:set': {
		params: { cloneDirectory: string }
		result: { cloneDirectory: string }
	}
	'config:list-dirs': {
		params: { path: string }
		result: { directories: string[] }
	}

	// GitHub
	'github:repos': {
		params: {}
		result: {
			repos: Array<{ full_name: string; name: string; private: boolean }>
		}
	}
	'github:orgs': { params: {}; result: { orgs: Array<{ login: string }> } }
	'github:org-repos': {
		params: { org: string }
		result: {
			repos: Array<{ full_name: string; name: string; private: boolean }>
		}
	}

	// Repos
	'repos:list': { params: {}; result: Repo[] }
	'repos:add': { params: { path: string }; result: Repo }
	'repos:clone': { params: { fullName: string }; result: Repo }
	'repos:delete': { params: { id: string }; result: { success: boolean } }
	'repos:teams': { params: { id: string }; result: Team[] }
	'repos:detect': { params: { id: string }; result: { detecting: boolean } }
	'repos:setup:list': { params: { id: string }; result: SetupStep[] }
	'repos:setup:add': {
		params: { id: string; name: string; run: string; background?: boolean }
		result: SetupStep[]
	}
	'repos:setup:update': {
		params: {
			id: string
			index: number
			name: string
			run: string
			background?: boolean
		}
		result: SetupStep[]
	}
	'repos:setup:delete': {
		params: { id: string; index: number }
		result: SetupStep[]
	}
	'repos:setup:reorder': {
		params: { id: string; order: number[] }
		result: SetupStep[]
	}
	'repos:scripts:list': { params: { id: string }; result: Script[] }
	'repos:scripts:create': {
		params: { id: string; name: string; run: string; background?: boolean }
		result: Script
	}

	// Scripts (top-level)
	'scripts:update': {
		params: { id: string; name: string; run: string; background?: boolean }
		result: Script
	}
	'scripts:delete': { params: { id: string }; result: { success: boolean } }

	// Teams
	'teams:list': { params: {}; result: Team[] }
	'teams:get': { params: { id: string }; result: TeamDetail }
	'teams:archive': { params: { id: string }; result: { success: boolean } }
	'teams:close': { params: { id: string }; result: { success: boolean } }
	'teams:agents:list': { params: { id: string }; result: Agent[] }
	'teams:agents:spawn': {
		params: { id: string; role: SpawnableRole }
		result: Agent
	}
	'teams:agents:respawn': {
		params: { teamId: string; agentId: string; prompt?: string }
		result: { success: boolean }
	}
	'teams:activity': {
		params: { id: string; since?: number }
		result: TeamActivity[]
	}
	'teams:logs': {
		params: { id: string; since?: number }
		result: TeamLog[]
	}
	'teams:prd': { params: { id: string }; result: { content: string } }
	'teams:design-doc': {
		params: { id: string }
		result: { content: string }
	}
	'teams:tasks': { params: { id: string }; result: AgentTask[] }
	'teams:notes': { params: { id: string }; result: { content: string } }

	// Teams - setup
	'teams:setup:retry': {
		params: { id: string }
		result: { success: boolean }
	}
	'teams:setup:cancel': {
		params: { id: string }
		result: { success: boolean }
	}
	'teams:setup:stop': {
		params: { id: string; step: number }
		result: { success: boolean }
	}
	'teams:setup:start': {
		params: { id: string; step: number }
		result: { success: boolean }
	}
	'teams:setup:logs': { params: { id: string }; result: SetupLogEntry[] }

	// Teams - build
	'teams:build:start': {
		params: { id: string }
		result: { success: boolean }
	}
	'teams:build:stop': {
		params: { id: string }
		result: { success: boolean }
	}
	'teams:build:logs': {
		params: { id: string }
		result: { status: string; output: string }
	}

	// Teams - scripts
	'teams:scripts:run': {
		params: { teamId: string; scriptId: string }
		result: { success: boolean }
	}
	'teams:scripts:stop': {
		params: { id: string }
		result: { success: boolean }
	}

	// Teams - dev server
	'teams:dev-server:start': {
		params: { id: string }
		result: { success: boolean; port: number }
	}
	'teams:dev-server:stop': {
		params: { id: string }
		result: { success: boolean }
	}
	'teams:dev-server:stdin': {
		params: { id: string; input: string }
		result: { success: boolean }
	}
	'teams:dev-server:logs': {
		params: { id: string }
		result: { status: string; output: string }
	}

	// Dashboard & usage
	dashboard: { params: {}; result: DashboardResult }
	conflicts: {
		params: {}
		result: Record<string, Record<string, string[]>>
	}
	usage: {
		params: { period?: string; teamId?: string; repoId?: string }
		result: UsageResult
	}

	// Activity
	'activity:insert': {
		params: {
			teamId: string
			agentId: string
			type: string
			payload: Record<string, unknown>
		}
		result: TeamActivity
	}
}

// Extended Team type returned by teams:get
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

// Server event map for typed on() listeners
export interface ServerEventMap {
	activity: (data: TeamActivity, channel: string) => void
	log: (data: TeamLog, channel: string) => void
	'team:update': (
		data: Partial<Team> & { id: string },
		channel: 'global',
	) => void
	'agent:update': (
		data: Partial<Agent> & { id: string; teamId: string },
		channel: string,
	) => void
	'replay:batch': (activity: TeamActivity[], channel: string) => void
	connected: () => void
	disconnected: () => void
	reconnecting: (attempt: number) => void
}
