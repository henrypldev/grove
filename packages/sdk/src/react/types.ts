import type {
  Agent,
  AgentTask,
  DashboardResult,
  Repo,
  Script,
  SetupStep,
  SpawnableRole,
  Team,
  TeamActivity,
  TeamDetail,
  TeamLog,
  UsageResult,
} from '@usegrove/shared'
import type { SetupLogEntry } from '../types'

/** Maps GET endpoint paths to their param/query/response types */
export interface RouteMap {
  '/v2/version': {
    response: { version: string }
  }
  '/v2/config/settings': {
    response: Record<string, string>
  }
  '/v2/config/clone-directory': {
    response: { cloneDirectory: string }
  }
  '/v2/config/list-directories': {
    query: { path?: string }
    response: { directories: string[] }
  }
  '/v2/github/repos': {
    response: { repos: Array<{ full_name: string; name: string; private: boolean }> }
  }
  '/v2/github/repos/orgs': {
    response: { orgs: Array<{ login: string }> }
  }
  '/v2/github/repos/orgs/:org': {
    params: { org: string }
    response: { repos: Array<{ full_name: string; name: string; private: boolean }> }
  }
  '/v2/repos': {
    response: Repo[]
  }
  '/v2/repos/:id': {
    params: { id: string }
    response: Repo
  }
  '/v2/repos/:id/teams': {
    params: { id: string }
    response: Team[]
  }
  '/v2/repos/:id/setup': {
    params: { id: string }
    response: SetupStep[]
  }
  '/v2/repos/:id/scripts': {
    params: { id: string }
    response: Script[]
  }
  '/v2/teams': {
    response: Team[]
  }
  '/v2/teams/:id': {
    params: { id: string }
    response: TeamDetail
  }
  '/v2/teams/:id/agents': {
    params: { id: string }
    response: Agent[]
  }
  '/v2/teams/:id/activity': {
    params: { id: string }
    query: { since?: number }
    response: TeamActivity[]
  }
  '/v2/teams/:id/logs': {
    params: { id: string }
    query: { since?: number }
    response: TeamLog[]
  }
  '/v2/teams/:id/prd': {
    params: { id: string }
    response: { content: string }
  }
  '/v2/teams/:id/design-doc': {
    params: { id: string }
    response: { content: string }
  }
  '/v2/teams/:id/tasks': {
    params: { id: string }
    response: AgentTask[]
  }
  '/v2/teams/:id/notes': {
    params: { id: string }
    response: { content: string }
  }
  '/v2/teams/:id/setup/logs': {
    params: { id: string }
    response: SetupLogEntry[]
  }
  '/v2/teams/:id/build/logs': {
    params: { id: string }
    response: { status: string; output: string }
  }
  '/v2/teams/:id/dev-server/logs': {
    params: { id: string }
    response: { status: string; output: string }
  }
  '/v2/dashboard': {
    response: DashboardResult
  }
  '/v2/conflicts': {
    response: Record<string, Record<string, string[]>>
  }
  '/v2/usage': {
    query: { period?: string; teamId?: string; repoId?: string }
    response: UsageResult
  }
}

/** Maps "METHOD path" to body/params/response for mutations */
export interface MutationMap {
  'POST /v2/repos': {
    body: { path: string }
    response: Repo
  }
  'POST /v2/repos/clone': {
    body: { fullName: string }
    response: Repo
  }
  'DELETE /v2/repos/:id': {
    params: { id: string }
    response: { success: true }
  }
  'POST /v2/repos/:id/setup': {
    params: { id: string }
    body: { name: string; run: string; background?: boolean }
    response: SetupStep[]
  }
  'PUT /v2/repos/:id/setup': {
    params: { id: string }
    body: { index: number; name: string; run: string; background?: boolean }
    response: SetupStep[]
  }
  'DELETE /v2/repos/:id/setup': {
    params: { id: string }
    body: { index: number }
    response: SetupStep[]
  }
  'PATCH /v2/repos/:id/setup/reorder': {
    params: { id: string }
    body: { order: number[] }
    response: SetupStep[]
  }
  'POST /v2/repos/:id/detect': {
    params: { id: string }
    response: { detecting: true }
  }
  'POST /v2/repos/:id/scripts': {
    params: { id: string }
    body: { name: string; run: string; background?: boolean }
    response: Script
  }
  'PUT /v2/scripts/:id': {
    params: { id: string }
    body: { name: string; run: string; background?: boolean }
    response: Script
  }
  'DELETE /v2/scripts/:id': {
    params: { id: string }
    response: { success: true }
  }
  'PATCH /v2/config/settings': {
    body: Record<string, string>
    response: Record<string, string>
  }
  'PUT /v2/config/clone-directory': {
    body: { cloneDirectory: string }
    response: { cloneDirectory: string }
  }
  'POST /v2/teams': {
    body: { repoId: string; task: string; files?: File[] }
    response: Team | { teams: Team[] }
  }
  'DELETE /v2/teams/:id': {
    params: { id: string }
    response: { success: true }
  }
  'POST /v2/teams/:id/close': {
    params: { id: string }
    response: { success: true }
  }
  'POST /v2/teams/:id/messages': {
    params: { id: string }
    body: { text?: string; files?: File[]; answers?: Record<string, string> }
    response: TeamActivity
  }
  'POST /v2/teams/:id/agents': {
    params: { id: string }
    body: { role: SpawnableRole }
    response: Agent
  }
  'POST /v2/teams/:teamId/agents/:agentId/respawn': {
    params: { teamId: string; agentId: string }
    body: { prompt?: string }
    response: { success: boolean }
  }
  'POST /v2/teams/:id/setup/retry': {
    params: { id: string }
    response: { success: true }
  }
  'POST /v2/teams/:id/setup/cancel': {
    params: { id: string }
    response: { success: true }
  }
  'POST /v2/teams/:id/setup/start': {
    params: { id: string }
    body: { step: number }
    response: { success: true }
  }
  'POST /v2/teams/:id/setup/stop': {
    params: { id: string }
    body: { step: number }
    response: { success: true }
  }
  'POST /v2/teams/:id/build': {
    params: { id: string }
    response: { success: true }
  }
  'POST /v2/teams/:id/build/stop': {
    params: { id: string }
    response: { success: true }
  }
  'POST /v2/teams/:teamId/scripts/:scriptId/run': {
    params: { teamId: string; scriptId: string }
    response: { success: true }
  }
  'POST /v2/teams/:id/scripts/stop': {
    params: { id: string }
    response: { success: true }
  }
  'POST /v2/teams/:id/dev-server': {
    params: { id: string }
    response: { success: true; port: number }
  }
  'POST /v2/teams/:id/dev-server/stop': {
    params: { id: string }
    response: { success: true }
  }
  'POST /v2/teams/:id/dev-server/stdin': {
    params: { id: string }
    body: { input: string }
    response: { success: true }
  }
  'POST /v2/activity': {
    body: { teamId: string; agentId: string; type: string; payload: Record<string, unknown> }
    response: TeamActivity
  }
}

/** Maps WS event names to their payload types */
export interface SubscriptionMap {
  activity: { data: TeamActivity; channel: string }
  log: { data: TeamLog; channel: string }
  'team:update': { data: Partial<Team> & { id: string }; channel: string }
  'agent:update': { data: Partial<Agent> & { id: string; teamId: string }; channel: string }
  'replay:batch': { data: TeamActivity[]; channel: string }
}

/** Utility: extract params type from RouteMap entry, defaulting to undefined */
export type RouteParams<P extends keyof RouteMap> =
  'params' extends keyof RouteMap[P] ? RouteMap[P]['params'] : undefined

/** Utility: extract query type from RouteMap entry */
export type RouteQuery<P extends keyof RouteMap> =
  'query' extends keyof RouteMap[P] ? RouteMap[P]['query'] : undefined

/** Utility: extract response type */
export type RouteResponse<P extends keyof RouteMap> = RouteMap[P]['response']

/** Extract method + path key from MutationMap */
export type MutationKey = keyof MutationMap

/** Utility: extract parts from a MutationMap entry */
export type MutationParams<K extends MutationKey> =
  'params' extends keyof MutationMap[K] ? MutationMap[K]['params'] : undefined

export type MutationBody<K extends MutationKey> =
  'body' extends keyof MutationMap[K] ? MutationMap[K]['body'] : undefined

export type MutationResponse<K extends MutationKey> = MutationMap[K]['response']

/** Subscription event names */
export type SubscriptionEvent = keyof SubscriptionMap
