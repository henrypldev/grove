import type { ServerWebSocket } from 'bun'
import { insertActivity } from '../routes/v2/activity'
import { getConflicts, getDashboard } from '../routes/v2/dashboard'
import {
	addRepoHandler,
	addSetupStep,
	cloneRepoHandler,
	createRepoScript,
	deleteRepo,
	deleteScript,
	deleteSetupStep,
	detectRepoSetup,
	getCloneDir,
	getSettings,
	getVersion,
	listDirs,
	listGithubOrgs,
	listGithubRepos,
	listOrgRepos,
	listRepoScripts,
	listRepos,
	listRepoTeams,
	listSetupSteps,
	reorderSetupSteps,
	setCloneDir,
	updateScript,
	updateSettings,
	updateSetupStep,
} from '../routes/v2/repos'
import {
	archiveTeam,
	cancelSetup,
	closeTeam,
	getBuildLogs,
	getDevServerLogs,
	getSetupLogs,
	getTeam,
	getTeamActivity,
	getTeamDesignDoc,
	getTeamLogs,
	getTeamNotes,
	getTeamPrd,
	getTeamTasks,
	listTeamAgents,
	listTeams,
	respawnAgent,
	retrySetup,
	runTeamScript,
	sendDevServerInput,
	spawnAgent,
	startBuild,
	startDevServer,
	startSetup,
	stopBuild,
	stopDevServer,
	stopSetup,
	stopTeamScript,
} from '../routes/v2/teams'
import { getUsage } from '../routes/v2/usage'
import type { SpawnableRole, WsServerMessage } from '../types'

type RpcHandler = (
	params: Record<string, unknown>,
) => Promise<unknown> | unknown

const methods = new Map<string, RpcHandler>()

function register(method: string, handler: RpcHandler) {
	methods.set(method, handler)
}

// Config & version
register('version', () => getVersion())
register('config:settings:get', () => getSettings())
register('config:settings:update', p =>
	updateSettings({ settings: (p.settings ?? p) as Record<string, string> }),
)
register('config:clone-dir:get', () => getCloneDir())
register('config:clone-dir:set', p =>
	setCloneDir({ cloneDirectory: p.cloneDirectory as string }),
)
register('config:list-dirs', p => listDirs({ path: (p.path as string) ?? '/' }))

// GitHub
register('github:repos', () => listGithubRepos())
register('github:orgs', () => listGithubOrgs())
register('github:org-repos', p => listOrgRepos({ org: p.org as string }))

// Repos
register('repos:list', () => listRepos())
register('repos:add', p => addRepoHandler({ path: p.path as string }))
register('repos:clone', p =>
	cloneRepoHandler({ fullName: p.fullName as string }),
)
register('repos:delete', p => deleteRepo({ id: p.id as string }))
register('repos:teams', p => listRepoTeams({ id: p.id as string }))
register('repos:setup:list', p => listSetupSteps({ id: p.id as string }))
register('repos:setup:add', p =>
	addSetupStep({
		id: p.id as string,
		name: p.name as string,
		run: p.run as string,
		background: p.background as boolean | undefined,
	}),
)
register('repos:setup:update', p =>
	updateSetupStep({
		id: p.id as string,
		index: p.index as number,
		name: p.name as string,
		run: p.run as string,
		background: p.background as boolean | undefined,
	}),
)
register('repos:setup:delete', p =>
	deleteSetupStep({ id: p.id as string, index: p.index as number }),
)
register('repos:setup:reorder', p =>
	reorderSetupSteps({ id: p.id as string, order: p.order as number[] }),
)
register('repos:detect', p => detectRepoSetup({ id: p.id as string }))
register('repos:scripts:list', p => listRepoScripts({ id: p.id as string }))
register('repos:scripts:create', p =>
	createRepoScript({
		id: p.id as string,
		name: p.name as string,
		run: p.run as string,
		background: p.background as boolean | undefined,
	}),
)

// Scripts (top-level)
register('scripts:update', p =>
	updateScript({
		id: p.id as string,
		name: p.name as string,
		run: p.run as string,
		background: p.background as boolean | undefined,
	}),
)
register('scripts:delete', p => deleteScript({ id: p.id as string }))

// Teams
register('teams:list', () => listTeams())
register('teams:get', p => getTeam({ id: p.id as string }))
register('teams:archive', p => archiveTeam({ id: p.id as string }))
register('teams:close', p => closeTeam({ id: p.id as string }))
register('teams:agents:list', p => listTeamAgents({ id: p.id as string }))
register('teams:agents:spawn', p =>
	spawnAgent({
		id: p.id as string,
		role: p.role as SpawnableRole,
	}),
)
register('teams:agents:respawn', p =>
	respawnAgent({
		teamId: p.teamId as string,
		agentId: p.agentId as string,
		prompt: p.prompt as string | undefined,
	}),
)
register('teams:activity', p =>
	getTeamActivity({ id: p.id as string, since: (p.since as number) ?? 0 }),
)
register('teams:logs', p =>
	getTeamLogs({ id: p.id as string, since: (p.since as number) ?? 0 }),
)
register('teams:prd', p => getTeamPrd({ id: p.id as string }))
register('teams:design-doc', p => getTeamDesignDoc({ id: p.id as string }))
register('teams:tasks', p => getTeamTasks({ id: p.id as string }))
register('teams:notes', p => getTeamNotes({ id: p.id as string }))

// Teams - setup
register('teams:setup:retry', p => retrySetup({ id: p.id as string }))
register('teams:setup:cancel', p => cancelSetup({ id: p.id as string }))
register('teams:setup:stop', p =>
	stopSetup({ id: p.id as string, step: p.step as number }),
)
register('teams:setup:start', p =>
	startSetup({ id: p.id as string, step: p.step as number }),
)
register('teams:setup:logs', p => getSetupLogs({ id: p.id as string }))

// Teams - build
register('teams:build:start', p => startBuild({ id: p.id as string }))
register('teams:build:stop', p => stopBuild({ id: p.id as string }))
register('teams:build:logs', p => getBuildLogs({ id: p.id as string }))

// Teams - scripts
register('teams:scripts:run', p =>
	runTeamScript({ teamId: p.teamId as string, scriptId: p.scriptId as string }),
)
register('teams:scripts:stop', p => stopTeamScript({ id: p.id as string }))

// Teams - dev server
register('teams:dev-server:start', p => startDevServer({ id: p.id as string }))
register('teams:dev-server:stop', p => stopDevServer({ id: p.id as string }))
register('teams:dev-server:stdin', p =>
	sendDevServerInput({ id: p.id as string, input: p.input as string }),
)
register('teams:dev-server:logs', p => getDevServerLogs({ id: p.id as string }))

// Dashboard & usage
register('dashboard', () => getDashboard())
register('conflicts', () => getConflicts())
register('usage', p =>
	getUsage({
		period: p.period as string | undefined,
		teamId: p.teamId as string | undefined,
		repoId: p.repoId as string | undefined,
	}),
)

// Activity
register('activity:insert', p =>
	insertActivity({
		teamId: p.teamId as string,
		agentId: p.agentId as string,
		type: p.type as string,
		payload: p.payload as Record<string, unknown>,
	}),
)

export async function handleRpc(
	ws: ServerWebSocket<unknown>,
	msg: { id: string; method: string; params?: Record<string, unknown> },
) {
	const handler = methods.get(msg.method)
	if (!handler) {
		ws.send(
			JSON.stringify({
				type: 'rpc:response',
				id: msg.id,
				error: `Unknown method: ${msg.method}`,
			} satisfies WsServerMessage),
		)
		return
	}
	try {
		const result = await handler(msg.params ?? {})
		ws.send(
			JSON.stringify({
				type: 'rpc:response',
				id: msg.id,
				data: result,
			} satisfies WsServerMessage),
		)
	} catch (err) {
		ws.send(
			JSON.stringify({
				type: 'rpc:response',
				id: msg.id,
				error: err instanceof Error ? err.message : String(err),
			} satisfies WsServerMessage),
		)
	}
}
