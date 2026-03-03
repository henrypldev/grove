import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import {
	getExpoBuildOutput,
	getExpoBuildStatus,
	rebuildExpoBuild,
	stopExpoBuild,
} from '../../api/expo-build'
import {
	getExpoDevServerOutput,
	getExpoDevServerStatus,
	sendExpoDevServerCommand,
	startExpoDevServer,
	stopExpoDevServer,
} from '../../api/expo-dev-server'
import {
	allocatePort,
	getTeamPort,
	isPortActive,
	setTeamPort,
} from '../../api/ports'
import { runScript, stopScript } from '../../api/scripts'
import {
	cancelTeamSetup,
	getTeamSetupLogs,
	retryTeamSetup,
	startTeamSetup,
	startTeamStep,
	stopTeamStep,
} from '../../api/setup-v2'
import { getTeamDeviceUdid } from '../../api/simulator'
import { createWorktree } from '../../api/worktrees'
import { generateId, getTerminalHost } from '../../config'
import { dbInsertActivity, dbListActivitySince } from '../../db/activity'
import { dbGetNote } from '../../db/agent-notes'
import { dbListTasks } from '../../db/agent-tasks'
import { dbGetAgent, dbListAgentsByTeam } from '../../db/agents'
import { dbGetDesignDoc } from '../../db/design-docs'
import { dbListLogsSince } from '../../db/logs'
import { dbGetPrd } from '../../db/prds'
import { dbGetRepo } from '../../db/repos'
import { dbGetScript } from '../../db/scripts'
import { dbInsertTeamDependency } from '../../db/team-dependencies'
import {
	dbArchiveTeam,
	dbGetTeam,
	dbInsertTeam,
	dbListTeams,
	dbUpdateTeamTitle,
} from '../../db/teams'
import { parseBatchTasks } from '../../parse-batch-tasks'
import type { Team } from '../../types'

const IMAGE_TYPES = new Set([
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/webp',
])
const PDF_TYPE = 'application/pdf'
const MAX_FILE_SIZE = 5 * 1024 * 1024

function matchRoute(
	path: string,
	pattern: string,
): Record<string, string> | null {
	const pathParts = path.split('/').filter(Boolean)
	const patternParts = pattern.split('/').filter(Boolean)
	if (pathParts.length !== patternParts.length) return null
	const params: Record<string, string> = {}
	for (let i = 0; i < patternParts.length; i++) {
		if (patternParts[i].startsWith(':')) {
			params[patternParts[i].slice(1)] = pathParts[i]
		} else if (patternParts[i] !== pathParts[i]) {
			return null
		}
	}
	return params
}

export let onTeamCreated:
	| ((
			team: Team,
			contentBlocks?: SDKUserMessage['message']['content'],
	  ) => Promise<void>)
	| null = null
export function setTeamCreatedHook(
	hook: (
		team: Team,
		contentBlocks?: SDKUserMessage['message']['content'],
	) => Promise<void>,
) {
	onTeamCreated = hook
}

// --- Extracted standalone functions ---

export function listTeams() {
	return dbListTeams()
}

export async function getTeam(params: { id: string }) {
	const team = dbGetTeam(params.id)
	if (!team) return { error: 'Team not found' }
	const agents = dbListAgentsByTeam(params.id)
	const port = getTeamPort(params.id)
	const portAlive = port && isPortActive(port)
	const devUrl = portAlive ? `https://${await getTerminalHost()}:${port}` : null
	const simulatorUdid = getTeamDeviceUdid(params.id)
	const expoBuildStatus = getExpoBuildStatus(params.id)
	const expoDevServerStatus = getExpoDevServerStatus(params.id)
	const repo = dbGetRepo(team.repoId)
	// Auto-create simulator for expo repos if one doesn't exist yet
	if (!simulatorUdid && !expoBuildStatus && repo?.framework === 'expo') {
		rebuildExpoBuild(params.id, team.worktreePath).catch(() => {})
	}
	const simulatorDeviceName = simulatorUdid ? `grove-team-${params.id}` : null
	const devServerStatus = portAlive ? 'running' : port ? 'starting' : null
	return {
		...team,
		port: portAlive ? port : null,
		devUrl,
		agents,
		simulatorUdid,
		simulatorDeviceName,
		expoBuildStatus,
		expoDevServerStatus,
		devServerStatus,
	}
}

export function archiveTeam(params: { id: string }) {
	const team = dbGetTeam(params.id)
	if (!team) return { error: 'Team not found' }
	dbArchiveTeam(params.id)
	return { success: true }
}

export function listTeamAgents(params: { id: string }) {
	const team = dbGetTeam(params.id)
	if (!team) return { error: 'Team not found' }
	return dbListAgentsByTeam(params.id)
}

export async function spawnAgent(params: {
	id: string
	role: 'team-lead' | 'dev' | 'qa' | 'reviewer' | 'env'
}) {
	const team = dbGetTeam(params.id)
	if (!team) return { error: 'Team not found' }
	const { spawnTeamLead, spawnDeveloper, spawnQaAgent, spawnReviewerAgent } =
		await import('../../agents/specialists')
	let agent: Awaited<ReturnType<typeof spawnDeveloper>> | undefined
	switch (params.role) {
		case 'team-lead':
			agent = await spawnTeamLead(team)
			break
		case 'dev':
			agent = await spawnDeveloper(team)
			break
		case 'qa':
			agent = await spawnQaAgent(team)
			break
		case 'reviewer':
			agent = await spawnReviewerAgent(team)
			break
		default:
			return { error: 'Invalid role' }
	}
	return agent
}

export async function respawnAgent(params: {
	teamId: string
	agentId: string
	prompt?: string
}) {
	const team = dbGetTeam(params.teamId)
	if (!team) return { error: 'Team not found' }
	const agent = dbGetAgent(params.agentId)
	if (!agent) return { error: 'Agent not found' }
	const { respawnAgent: doRespawn } = await import('../../agents/runner')
	const success = await doRespawn(
		params.agentId,
		params.prompt ?? agent.currentTask ?? '',
		team.worktreePath,
	)
	return { success }
}

export async function closeTeam(params: { id: string }) {
	const team = dbGetTeam(params.id)
	if (!team) return { error: 'Team not found' }
	const { closeTeam: doClose } = await import('../../agents/orchestrator')
	await doClose(team.id)
	return { success: true }
}

export function getTeamActivity(params: { id: string; since: number }) {
	return dbListActivitySince(params.id, params.since)
}

export function getTeamLogs(params: { id: string; since: number }) {
	return dbListLogsSince(params.id, params.since)
}

export function getTeamPrd(params: { id: string }) {
	const prd = dbGetPrd(params.id)
	if (!prd) return { error: 'PRD not found' }
	return { content: prd.content }
}

export function getTeamDesignDoc(params: { id: string }) {
	const doc = dbGetDesignDoc(params.id)
	if (!doc) return { error: 'Design doc not found' }
	return { content: doc.content }
}

export function getTeamTasks(params: { id: string }) {
	return dbListTasks(params.id)
}

export function getTeamNotes(params: { id: string }) {
	const note = dbGetNote(params.id)
	if (!note) return { error: 'Notes not found' }
	return { content: note.content }
}

export async function retrySetup(params: { id: string }) {
	const team = dbGetTeam(params.id)
	if (!team) return { error: 'Team not found' }
	const repo = dbGetRepo(team.repoId)
	await retryTeamSetup(params.id, team.worktreePath, repo?.setupSteps)
	return { success: true }
}

export function cancelSetup(params: { id: string }) {
	const team = dbGetTeam(params.id)
	if (!team) return { error: 'Team not found' }
	cancelTeamSetup(params.id)
	return { success: true }
}

export function stopSetup(params: { id: string; step: number }) {
	const team = dbGetTeam(params.id)
	if (!team) return { error: 'Team not found' }
	const error = stopTeamStep(params.id, params.step)
	if (error) return { error }
	return { success: true }
}

export function startSetup(params: { id: string; step: number }) {
	const team = dbGetTeam(params.id)
	if (!team) return { error: 'Team not found' }
	const error = startTeamStep(params.id, params.step)
	if (error) return { error }
	return { success: true }
}

export function getSetupLogs(params: { id: string }) {
	const logs = getTeamSetupLogs(params.id)
	if (!logs) return { error: 'No active setup' }
	return logs
}

export async function startBuild(params: { id: string }) {
	const team = dbGetTeam(params.id)
	if (!team) return { error: 'Team not found' }
	try {
		await rebuildExpoBuild(params.id, team.worktreePath)
	} catch (err) {
		return { error: String(err) }
	}
	return { success: true }
}

export function stopBuild(params: { id: string }) {
	const team = dbGetTeam(params.id)
	if (!team) return { error: 'Team not found' }
	stopExpoBuild(params.id)
	return { success: true }
}

export function getBuildLogs(params: { id: string }) {
	const status = getExpoBuildStatus(params.id)
	const output = getExpoBuildOutput(params.id)
	if (status === null) return { error: 'No active build' }
	return { status, output }
}

export async function runTeamScript(params: {
	teamId: string
	scriptId: string
}) {
	const team = dbGetTeam(params.teamId)
	if (!team) return { error: 'Team not found' }
	const script = dbGetScript(params.scriptId)
	if (!script) return { error: 'Script not found' }
	const error = await runScript(params.teamId, team.worktreePath, script)
	if (error) return { error }
	return { success: true }
}

export function stopTeamScript(params: { id: string }) {
	const team = dbGetTeam(params.id)
	if (!team) return { error: 'Team not found' }
	const error = stopScript(params.id)
	if (error) return { error }
	return { success: true }
}

export async function startDevServer(params: { id: string }) {
	const team = dbGetTeam(params.id)
	if (!team) return { error: 'Team not found' }
	let port = getTeamPort(params.id)
	if (!port) {
		port = (await allocatePort()) ?? null
		if (port) setTeamPort(params.id, port)
	}
	if (!port) return { error: 'No port available' }
	startExpoDevServer(params.id, team.worktreePath, port)
	return { success: true, port }
}

export function stopDevServer(params: { id: string }) {
	const team = dbGetTeam(params.id)
	if (!team) return { error: 'Team not found' }
	stopExpoDevServer(params.id)
	return { success: true }
}

export async function sendDevServerInput(params: {
	id: string
	input: string
}) {
	const sent = await sendExpoDevServerCommand(params.id, params.input)
	if (!sent) return { error: 'No active dev server' }
	return { success: true }
}

export function getDevServerLogs(params: { id: string }) {
	const status = getExpoDevServerStatus(params.id)
	const output = getExpoDevServerOutput(params.id)
	if (status === null) return { error: 'No active dev server' }
	return { status, output }
}

// --- HTTP handler ---

export async function handleV2Teams(
	req: Request,
	url: URL,
	headers: Record<string, string>,
): Promise<Response | null> {
	const path = url.pathname
	const method = req.method

	if (path === '/v2/teams' && method === 'GET') {
		const result = await listTeams()
		return Response.json(result, { headers })
	}

	if (path === '/v2/teams' && method === 'POST') {
		let repoId: string | undefined
		let task: string | undefined
		let contentBlocks: SDKUserMessage['message']['content'] | undefined

		const contentType = req.headers.get('content-type') ?? ''
		if (contentType.includes('multipart/form-data')) {
			const formData = await req.formData()
			repoId = formData.get('repoId') as string | undefined
			task = formData.get('task') as string | undefined

			const files = formData.getAll('files') as File[]
			if (files.length > 0) {
				const blocks: Array<Record<string, unknown>> = []
				for (const file of files) {
					if (file.size > MAX_FILE_SIZE) continue
					const mime = file.type
					const data = Buffer.from(await file.arrayBuffer()).toString('base64')
					if (IMAGE_TYPES.has(mime)) {
						blocks.push({
							type: 'image',
							source: { type: 'base64', media_type: mime, data },
						})
					} else if (mime === PDF_TYPE) {
						blocks.push({
							type: 'document',
							source: { type: 'base64', media_type: mime, data },
						})
					}
				}
				if (blocks.length > 0 && task) {
					blocks.push({ type: 'text', text: task })
					contentBlocks = blocks as SDKUserMessage['message']['content']
				}
			}
		} else {
			const body = (await req.json()) as { repoId: string; task: string }
			repoId = body.repoId
			task = body.task
		}

		if (!repoId || !task) {
			return Response.json(
				{ error: 'Missing repoId or task' },
				{ status: 400, headers },
			)
		}
		const repo = dbGetRepo(repoId)
		if (!repo)
			return Response.json(
				{ error: 'Repo not found' },
				{ status: 404, headers },
			)

		const batch = parseBatchTasks(task)

		if (!batch) {
			const teamId = generateId()
			const branch = `grove-team-${teamId}`
			const worktree = await createWorktree(repoId, branch, 'main')
			if (typeof worktree === 'string') {
				return Response.json({ error: worktree }, { status: 400, headers })
			}

			const now = Date.now()
			const team: Team = {
				id: teamId,
				repoId,
				worktreePath: worktree.path,
				task,
				title: null,
				status: 'planning',
				pmSummary: null,
				prUrl: null,
				createdAt: now,
				updatedAt: now,
			}
			dbInsertTeam(team)

			const taskText = task
			import('../../agents/title').then(({ generateTeamTitle }) =>
				generateTeamTitle(taskText).then(title =>
					dbUpdateTeamTitle(teamId, title),
				),
			)

			startTeamSetup(teamId, worktree.path, repo.setupSteps, repo.id)

			if (onTeamCreated) await onTeamCreated(team, contentBlocks)

			return Response.json(team, { headers })
		}

		// Batch mode: create multiple teams
		const createdTeams: Team[] = []
		for (const parsed of batch.tasks) {
			const fullTask = parsed.task
			const teamId = generateId()
			const branch = `grove-team-${teamId}`
			const worktree = await createWorktree(repoId, branch, 'main')
			if (typeof worktree === 'string') {
				return Response.json({ error: worktree }, { status: 400, headers })
			}

			const now = Date.now()
			const team: Team = {
				id: teamId,
				repoId,
				worktreePath: worktree.path,
				task: fullTask,
				title: null,
				status: 'planning',
				pmSummary: null,
				prUrl: null,
				createdAt: now,
				updatedAt: now,
			}
			dbInsertTeam(team)

			import('../../agents/title').then(({ generateTeamTitle }) =>
				generateTeamTitle(fullTask).then(title =>
					dbUpdateTeamTitle(teamId, title),
				),
			)

			startTeamSetup(teamId, worktree.path, repo.setupSteps, repo.id)
			createdTeams.push(team)
		}

		// Insert dependencies (now all team IDs exist)
		for (let i = 0; i < batch.tasks.length; i++) {
			for (const depIdx of batch.tasks[i].dependsOn) {
				if (depIdx >= 1 && depIdx <= createdTeams.length) {
					dbInsertTeamDependency(
						createdTeams[i].id,
						createdTeams[depIdx - 1].id,
					)
				}
			}
		}

		// Trigger onTeamCreated for each
		for (const team of createdTeams) {
			if (onTeamCreated) await onTeamCreated(team, contentBlocks)
		}

		return Response.json({ teams: createdTeams }, { headers })
	}

	const teamMatch = matchRoute(path, '/v2/teams/:id')
	if (teamMatch) {
		if (method === 'GET') {
			const result = await getTeam({ id: teamMatch.id })
			if ('error' in result)
				return Response.json(result, { status: 404, headers })
			return Response.json(result, { headers })
		}
		if (method === 'DELETE') {
			const result = await archiveTeam({ id: teamMatch.id })
			if ('error' in result)
				return Response.json(result, { status: 404, headers })
			return Response.json(result, { headers })
		}
	}

	const agentsMatch = matchRoute(path, '/v2/teams/:id/agents')
	if (agentsMatch) {
		if (method === 'GET') {
			const result = await listTeamAgents({ id: agentsMatch.id })
			if ('error' in result)
				return Response.json(result, { status: 404, headers })
			return Response.json(result, { headers })
		}
		if (method === 'POST') {
			const body = (await req.json()) as {
				role: 'team-lead' | 'dev' | 'qa' | 'reviewer' | 'env'
			}
			const result = await spawnAgent({ id: agentsMatch.id, role: body.role })
			if (result && 'error' in result)
				return Response.json(result, { status: 400, headers })
			return Response.json(result, { headers })
		}
	}

	const respawnMatch = matchRoute(
		path,
		'/v2/teams/:teamId/agents/:agentId/respawn',
	)
	if (respawnMatch && method === 'POST') {
		const body = (await req.json()) as { prompt?: string }
		const result = await respawnAgent({
			teamId: respawnMatch.teamId,
			agentId: respawnMatch.agentId,
			prompt: body.prompt,
		})
		if ('error' in result) {
			const status =
				result.error === 'Team not found' || result.error === 'Agent not found'
					? 404
					: 400
			return Response.json(result, { status, headers })
		}
		return Response.json(result, { headers })
	}

	const closeMatch = matchRoute(path, '/v2/teams/:id/close')
	if (closeMatch && method === 'POST') {
		const result = await closeTeam({ id: closeMatch.id })
		if ('error' in result)
			return Response.json(result, { status: 404, headers })
		return Response.json(result, { headers })
	}

	const messagesMatch = matchRoute(path, '/v2/teams/:id/messages')
	if (messagesMatch && method === 'POST') {
		const team = dbGetTeam(messagesMatch.id)
		if (!team)
			return Response.json(
				{ error: 'Team not found' },
				{ status: 404, headers },
			)

		let text: string | undefined
		let contentBlocks: SDKUserMessage['message']['content'] | undefined

		const contentType = req.headers.get('content-type') ?? ''
		if (contentType.includes('multipart/form-data')) {
			const formData = await req.formData()
			text = formData.get('text') as string | undefined
			if (!text)
				return Response.json(
					{ error: 'Missing text' },
					{ status: 400, headers },
				)

			const files = formData.getAll('files') as File[]
			if (files.length > 0) {
				const blocks: Array<Record<string, unknown>> = []
				for (const file of files) {
					if (file.size > MAX_FILE_SIZE) continue
					const mime = file.type
					const data = Buffer.from(await file.arrayBuffer()).toString('base64')
					if (IMAGE_TYPES.has(mime)) {
						blocks.push({
							type: 'image',
							source: { type: 'base64', media_type: mime, data },
						})
					} else if (mime === PDF_TYPE) {
						blocks.push({
							type: 'document',
							source: { type: 'base64', media_type: mime, data },
						})
					}
				}
				if (blocks.length > 0) {
					blocks.push({ type: 'text', text })
					contentBlocks = blocks as SDKUserMessage['message']['content']
				}
			}
		} else {
			const body = (await req.json()) as {
				text?: string
				answers?: Record<string, string>
			}
			text = body.text
			if (body.answers) {
				const { resolveUserReply } = await import('../../agents/grove-tools')
				if (resolveUserReply(team.id, body.answers)) {
					const event = dbInsertActivity(team.id, null, 'user:answers', {
						answers: body.answers,
					})
					return Response.json(event, { headers })
				}
			}
		}

		if (!text)
			return Response.json({ error: 'Missing text' }, { status: 400, headers })

		const attachments = contentBlocks
			? (contentBlocks as Array<Record<string, unknown>>)
					.filter(b => b.type === 'image' || b.type === 'document')
					.map(b => {
						const src = b.source as Record<string, string>
						return { type: b.type as string, mediaType: src.media_type }
					})
			: undefined
		const event = dbInsertActivity(team.id, null, 'user:message', {
			text,
			...(attachments?.length ? { attachments } : {}),
		})
		const { routeMessageToAgents } = await import('../../agents/orchestrator')
		await routeMessageToAgents(team, text, undefined, contentBlocks)
		return Response.json(event, { headers })
	}

	const activityMatch = matchRoute(path, '/v2/teams/:id/activity')
	if (activityMatch && method === 'GET') {
		const since = Number(url.searchParams.get('since') ?? '0')
		const result = await getTeamActivity({ id: activityMatch.id, since })
		return Response.json(result, { headers })
	}

	const logsMatch = matchRoute(path, '/v2/teams/:id/logs')
	if (logsMatch && method === 'GET') {
		const since = Number(url.searchParams.get('since') ?? '0')
		const result = await getTeamLogs({ id: logsMatch.id, since })
		return Response.json(result, { headers })
	}

	const prdMatch = matchRoute(path, '/v2/teams/:id/prd')
	if (prdMatch && method === 'GET') {
		const result = await getTeamPrd({ id: prdMatch.id })
		if ('error' in result)
			return Response.json(result, { status: 404, headers })
		return Response.json(result, { headers })
	}

	const designDocMatch = matchRoute(path, '/v2/teams/:id/design-doc')
	if (designDocMatch && method === 'GET') {
		const result = await getTeamDesignDoc({ id: designDocMatch.id })
		if ('error' in result)
			return Response.json(result, { status: 404, headers })
		return Response.json(result, { headers })
	}

	const tasksMatch = matchRoute(path, '/v2/teams/:id/tasks')
	if (tasksMatch && method === 'GET') {
		const result = await getTeamTasks({ id: tasksMatch.id })
		return Response.json(result, { headers })
	}

	const notesMatch = matchRoute(path, '/v2/teams/:id/notes')
	if (notesMatch && method === 'GET') {
		const result = await getTeamNotes({ id: notesMatch.id })
		if ('error' in result)
			return Response.json(result, { status: 404, headers })
		return Response.json(result, { headers })
	}

	const setupRetryMatch = matchRoute(path, '/v2/teams/:id/setup/retry')
	if (setupRetryMatch && method === 'POST') {
		const result = await retrySetup({ id: setupRetryMatch.id })
		if ('error' in result)
			return Response.json(result, { status: 404, headers })
		return Response.json(result, { headers })
	}

	const setupCancelMatch = matchRoute(path, '/v2/teams/:id/setup/cancel')
	if (setupCancelMatch && method === 'POST') {
		const result = await cancelSetup({ id: setupCancelMatch.id })
		if ('error' in result)
			return Response.json(result, { status: 404, headers })
		return Response.json(result, { headers })
	}

	const setupStopMatch = matchRoute(path, '/v2/teams/:id/setup/stop')
	if (setupStopMatch && method === 'POST') {
		const body = (await req.json()) as { step?: number }
		if (typeof body.step !== 'number')
			return Response.json(
				{ error: 'Missing step index' },
				{ status: 400, headers },
			)
		const result = await stopSetup({ id: setupStopMatch.id, step: body.step })
		if ('error' in result)
			return Response.json(result, { status: 400, headers })
		return Response.json(result, { headers })
	}

	const setupStartMatch = matchRoute(path, '/v2/teams/:id/setup/start')
	if (setupStartMatch && method === 'POST') {
		const body = (await req.json()) as { step?: number }
		if (typeof body.step !== 'number')
			return Response.json(
				{ error: 'Missing step index' },
				{ status: 400, headers },
			)
		const result = await startSetup({
			id: setupStartMatch.id,
			step: body.step,
		})
		if ('error' in result)
			return Response.json(result, { status: 400, headers })
		return Response.json(result, { headers })
	}

	const setupLogsMatch = matchRoute(path, '/v2/teams/:id/setup/logs')
	if (setupLogsMatch && method === 'GET') {
		const result = await getSetupLogs({ id: setupLogsMatch.id })
		if ('error' in result)
			return Response.json(result, { status: 404, headers })
		return Response.json(result, { headers })
	}

	const buildMatch = matchRoute(path, '/v2/teams/:id/build')
	if (buildMatch && method === 'POST') {
		const result = await startBuild({ id: buildMatch.id })
		if ('error' in result) {
			const status = result.error === 'Team not found' ? 404 : 500
			return Response.json(result, { status, headers })
		}
		return Response.json(result, { headers })
	}

	const buildStopMatch = matchRoute(path, '/v2/teams/:id/build/stop')
	if (buildStopMatch && method === 'POST') {
		const result = await stopBuild({ id: buildStopMatch.id })
		if ('error' in result)
			return Response.json(result, { status: 404, headers })
		return Response.json(result, { headers })
	}

	const buildLogsMatch = matchRoute(path, '/v2/teams/:id/build/logs')
	if (buildLogsMatch && method === 'GET') {
		const result = await getBuildLogs({ id: buildLogsMatch.id })
		if ('error' in result)
			return Response.json(result, { status: 404, headers })
		return Response.json(result, { headers })
	}

	const scriptRunMatch = matchRoute(
		path,
		'/v2/teams/:teamId/scripts/:scriptId/run',
	)
	if (scriptRunMatch && method === 'POST') {
		const result = await runTeamScript({
			teamId: scriptRunMatch.teamId,
			scriptId: scriptRunMatch.scriptId,
		})
		if ('error' in result) {
			const status =
				result.error === 'Team not found' || result.error === 'Script not found'
					? 404
					: 400
			return Response.json(result, { status, headers })
		}
		return Response.json(result, { headers })
	}

	const scriptStopMatch = matchRoute(path, '/v2/teams/:id/scripts/stop')
	if (scriptStopMatch && method === 'POST') {
		const result = await stopTeamScript({ id: scriptStopMatch.id })
		if ('error' in result) {
			const status = result.error === 'Team not found' ? 404 : 400
			return Response.json(result, { status, headers })
		}
		return Response.json(result, { headers })
	}

	const devServerMatch = matchRoute(path, '/v2/teams/:id/dev-server')
	if (devServerMatch && method === 'POST') {
		const result = await startDevServer({ id: devServerMatch.id })
		if ('error' in result) {
			const status = result.error === 'Team not found' ? 404 : 500
			return Response.json(result, { status, headers })
		}
		return Response.json(result, { headers })
	}

	const devServerStopMatch = matchRoute(path, '/v2/teams/:id/dev-server/stop')
	if (devServerStopMatch && method === 'POST') {
		const result = await stopDevServer({ id: devServerStopMatch.id })
		if ('error' in result)
			return Response.json(result, { status: 404, headers })
		return Response.json(result, { headers })
	}

	const devServerStdinMatch = matchRoute(path, '/v2/teams/:id/dev-server/stdin')
	if (devServerStdinMatch && method === 'POST') {
		const body = (await req.json()) as { input: string }
		if (typeof body.input !== 'string' || body.input.length === 0)
			return Response.json({ error: 'Missing input' }, { status: 400, headers })
		const result = await sendDevServerInput({
			id: devServerStdinMatch.id,
			input: body.input,
		})
		if ('error' in result)
			return Response.json(result, { status: 404, headers })
		return Response.json(result, { headers })
	}

	const devServerLogsMatch = matchRoute(path, '/v2/teams/:id/dev-server/logs')
	if (devServerLogsMatch && method === 'GET') {
		const result = await getDevServerLogs({ id: devServerLogsMatch.id })
		if ('error' in result)
			return Response.json(result, { status: 404, headers })
		return Response.json(result, { headers })
	}

	return null
}
