import type { RpcMethods, SpawnableRole } from './types'

type RpcCaller = <M extends keyof RpcMethods>(
	method: M,
	params: RpcMethods[M]['params'],
) => Promise<RpcMethods[M]['result']>

export function buildRpcNamespaces(call: RpcCaller) {
	return {
		version: () => call('version', {}),

		config: {
			settings: {
				get: () => call('config:settings:get', {}),
				update: (p: { settings: Record<string, string> }) =>
					call('config:settings:update', p),
			},
			cloneDir: {
				get: () => call('config:clone-dir:get', {}),
				set: (p: { cloneDirectory: string }) =>
					call('config:clone-dir:set', p),
			},
			listDirs: (p: { path: string }) => call('config:list-dirs', p),
		},

		github: {
			repos: () => call('github:repos', {}),
			orgs: () => call('github:orgs', {}),
			orgRepos: (p: { org: string }) => call('github:org-repos', p),
		},

		repos: {
			list: () => call('repos:list', {}),
			add: (p: { path: string }) => call('repos:add', p),
			clone: (p: { fullName: string }) => call('repos:clone', p),
			delete: (p: { id: string }) => call('repos:delete', p),
			teams: (p: { id: string }) => call('repos:teams', p),
			detect: (p: { id: string }) => call('repos:detect', p),
			setup: {
				list: (p: { id: string }) => call('repos:setup:list', p),
				add: (p: {
					id: string
					name: string
					run: string
					background?: boolean
				}) => call('repos:setup:add', p),
				update: (p: {
					id: string
					index: number
					name: string
					run: string
					background?: boolean
				}) => call('repos:setup:update', p),
				delete: (p: { id: string; index: number }) =>
					call('repos:setup:delete', p),
				reorder: (p: { id: string; order: number[] }) =>
					call('repos:setup:reorder', p),
			},
			scripts: {
				list: (p: { id: string }) => call('repos:scripts:list', p),
				create: (p: {
					id: string
					name: string
					run: string
					background?: boolean
				}) => call('repos:scripts:create', p),
			},
		},

		scripts: {
			update: (p: {
				id: string
				name: string
				run: string
				background?: boolean
			}) => call('scripts:update', p),
			delete: (p: { id: string }) => call('scripts:delete', p),
		},

		teams: {
			list: () => call('teams:list', {}),
			get: (p: { id: string }) => call('teams:get', p),
			archive: (p: { id: string }) => call('teams:archive', p),
			close: (p: { id: string }) => call('teams:close', p),
			agents: {
				list: (p: { id: string }) => call('teams:agents:list', p),
				spawn: (p: { id: string; role: SpawnableRole }) =>
					call('teams:agents:spawn', p),
				respawn: (p: {
					teamId: string
					agentId: string
					prompt?: string
				}) => call('teams:agents:respawn', p),
			},
			activity: (p: { id: string; since?: number }) =>
				call('teams:activity', p),
			logs: (p: { id: string; since?: number }) =>
				call('teams:logs', p),
			prd: (p: { id: string }) => call('teams:prd', p),
			designDoc: (p: { id: string }) => call('teams:design-doc', p),
			tasks: (p: { id: string }) => call('teams:tasks', p),
			notes: (p: { id: string }) => call('teams:notes', p),
			setup: {
				retry: (p: { id: string }) => call('teams:setup:retry', p),
				cancel: (p: { id: string }) => call('teams:setup:cancel', p),
				stop: (p: { id: string; step: number }) =>
					call('teams:setup:stop', p),
				start: (p: { id: string; step: number }) =>
					call('teams:setup:start', p),
				logs: (p: { id: string }) => call('teams:setup:logs', p),
			},
			build: {
				start: (p: { id: string }) => call('teams:build:start', p),
				stop: (p: { id: string }) => call('teams:build:stop', p),
				logs: (p: { id: string }) => call('teams:build:logs', p),
			},
			scripts: {
				run: (p: { teamId: string; scriptId: string }) =>
					call('teams:scripts:run', p),
				stop: (p: { id: string }) => call('teams:scripts:stop', p),
			},
			devServer: {
				start: (p: { id: string }) =>
					call('teams:dev-server:start', p),
				stop: (p: { id: string }) => call('teams:dev-server:stop', p),
				stdin: (p: { id: string; input: string }) =>
					call('teams:dev-server:stdin', p),
				logs: (p: { id: string }) => call('teams:dev-server:logs', p),
			},
		},

		dashboard: () => call('dashboard', {}),
		conflicts: () => call('conflicts', {}),
		usage: (p?: { period?: string; teamId?: string; repoId?: string }) =>
			call('usage', p ?? {}),

		activity: {
			insert: (p: {
				teamId: string
				agentId: string
				type: string
				payload: Record<string, unknown>
			}) => call('activity:insert', p),
		},
	}
}

export type RpcNamespaces = ReturnType<typeof buildRpcNamespaces>
