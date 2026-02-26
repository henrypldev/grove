import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { isPortActive } from '../../api/ports'
import {
	cancelTeamSetup,
	retryTeamSetup,
	startTeamSetup,
	startTeamStep,
	stopTeamStep,
} from '../../api/setup-v2'
import { createWorktree } from '../../api/worktrees'
import { generateId, getTerminalHost } from '../../config'
import { dbGetNote } from '../../db/agent-notes'
import { dbListTasks } from '../../db/agent-tasks'
import { dbGetAgent, dbListAgentsByTeam } from '../../db/agents'
import { dbGetDesignDoc } from '../../db/design-docs'
import { dbInsertEvent, dbListEventsSince } from '../../db/events'
import { dbGetPrd } from '../../db/prds'
import { dbGetRepo } from '../../db/repos'
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

export async function handleV2Teams(
	req: Request,
	url: URL,
	headers: Record<string, string>,
): Promise<Response | null> {
	const path = url.pathname
	const method = req.method

	if (path === '/v2/teams' && method === 'GET') {
		return Response.json(dbListTeams(), { headers })
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
				port: null,
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

			startTeamSetup(teamId, worktree.path, repo.setupSteps)

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
				port: null,
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

			startTeamSetup(teamId, worktree.path, repo.setupSteps)
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
			const team = dbGetTeam(teamMatch.id)
			if (!team)
				return Response.json(
					{ error: 'Team not found' },
					{ status: 404, headers },
				)
			const agents = dbListAgentsByTeam(teamMatch.id)
			const portAlive = team.port && isPortActive(team.port)
			const devUrl = portAlive
				? `https://${await getTerminalHost()}:${team.port}`
				: null
			return Response.json(
				{ ...team, port: portAlive ? team.port : null, devUrl, agents },
				{ headers },
			)
		}
		if (method === 'DELETE') {
			const team = dbGetTeam(teamMatch.id)
			if (!team)
				return Response.json(
					{ error: 'Team not found' },
					{ status: 404, headers },
				)
			dbArchiveTeam(teamMatch.id)
			return Response.json({ success: true }, { headers })
		}
	}

	const agentsMatch = matchRoute(path, '/v2/teams/:id/agents')
	if (agentsMatch) {
		const team = dbGetTeam(agentsMatch.id)
		if (!team)
			return Response.json(
				{ error: 'Team not found' },
				{ status: 404, headers },
			)
		if (method === 'GET') {
			return Response.json(dbListAgentsByTeam(agentsMatch.id), { headers })
		}
		if (method === 'POST') {
			const body = (await req.json()) as {
				role: 'team-lead' | 'dev' | 'qa' | 'reviewer' | 'env'
			}
			const {
				spawnTeamLead,
				spawnDeveloper,
				spawnQaAgent,
				spawnReviewerAgent,
			} = await import('../../agents/specialists')
			let agent: Awaited<ReturnType<typeof spawnDeveloper>> | undefined
			switch (body.role) {
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
					return Response.json(
						{ error: 'Invalid role' },
						{ status: 400, headers },
					)
			}
			return Response.json(agent, { headers })
		}
	}

	const respawnMatch = matchRoute(
		path,
		'/v2/teams/:teamId/agents/:agentId/respawn',
	)
	if (respawnMatch && method === 'POST') {
		const team = dbGetTeam(respawnMatch.teamId)
		if (!team)
			return Response.json(
				{ error: 'Team not found' },
				{ status: 404, headers },
			)
		const agent = dbGetAgent(respawnMatch.agentId)
		if (!agent)
			return Response.json(
				{ error: 'Agent not found' },
				{ status: 404, headers },
			)
		const body = (await req.json()) as { prompt?: string }
		const { respawnAgent } = await import('../../agents/runner')
		const success = await respawnAgent(
			respawnMatch.agentId,
			body.prompt ?? agent.currentTask ?? '',
			team.worktreePath,
		)
		return Response.json({ success }, { headers })
	}

	const closeMatch = matchRoute(path, '/v2/teams/:id/close')
	if (closeMatch && method === 'POST') {
		const team = dbGetTeam(closeMatch.id)
		if (!team)
			return Response.json(
				{ error: 'Team not found' },
				{ status: 404, headers },
			)
		const { closeTeam } = await import('../../agents/orchestrator')
		await closeTeam(team.id)
		return Response.json({ success: true }, { headers })
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
					const event = dbInsertEvent(team.id, null, 'user:answers', {
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
		const event = dbInsertEvent(team.id, null, 'user:message', {
			text,
			...(attachments?.length ? { attachments } : {}),
		})
		const { routeMessageToAgents } = await import('../../agents/orchestrator')
		await routeMessageToAgents(team, text, undefined, contentBlocks)
		return Response.json(event, { headers })
	}

	const eventsMatch = matchRoute(path, '/v2/teams/:id/events')
	if (eventsMatch && method === 'GET') {
		const since = Number(url.searchParams.get('since') ?? '0')
		const events = dbListEventsSince(eventsMatch.id, since)
		return Response.json(events, { headers })
	}

	const prdMatch = matchRoute(path, '/v2/teams/:id/prd')
	if (prdMatch && method === 'GET') {
		const prd = dbGetPrd(prdMatch.id)
		if (!prd)
			return Response.json({ error: 'PRD not found' }, { status: 404, headers })
		return Response.json({ content: prd.content }, { headers })
	}

	const designDocMatch = matchRoute(path, '/v2/teams/:id/design-doc')
	if (designDocMatch && method === 'GET') {
		const doc = dbGetDesignDoc(designDocMatch.id)
		if (!doc)
			return Response.json(
				{ error: 'Design doc not found' },
				{ status: 404, headers },
			)
		return Response.json({ content: doc.content }, { headers })
	}

	const tasksMatch = matchRoute(path, '/v2/teams/:id/tasks')
	if (tasksMatch && method === 'GET') {
		const tasks = dbListTasks(tasksMatch.id)
		return Response.json(tasks, { headers })
	}

	const notesMatch = matchRoute(path, '/v2/teams/:id/notes')
	if (notesMatch && method === 'GET') {
		const note = dbGetNote(notesMatch.id)
		if (!note)
			return Response.json(
				{ error: 'Notes not found' },
				{ status: 404, headers },
			)
		return Response.json({ content: note.content }, { headers })
	}

	const setupRetryMatch = matchRoute(path, '/v2/teams/:id/setup/retry')
	if (setupRetryMatch && method === 'POST') {
		const team = dbGetTeam(setupRetryMatch.id)
		if (!team)
			return Response.json(
				{ error: 'Team not found' },
				{ status: 404, headers },
			)
		const repo = dbGetRepo(team.repoId)
		await retryTeamSetup(
			setupRetryMatch.id,
			team.worktreePath,
			repo?.setupSteps,
		)
		return Response.json({ success: true }, { headers })
	}

	const setupCancelMatch = matchRoute(path, '/v2/teams/:id/setup/cancel')
	if (setupCancelMatch && method === 'POST') {
		const team = dbGetTeam(setupCancelMatch.id)
		if (!team)
			return Response.json(
				{ error: 'Team not found' },
				{ status: 404, headers },
			)
		cancelTeamSetup(setupCancelMatch.id)
		return Response.json({ success: true }, { headers })
	}

	const setupStopMatch = matchRoute(path, '/v2/teams/:id/setup/stop')
	if (setupStopMatch && method === 'POST') {
		const team = dbGetTeam(setupStopMatch.id)
		if (!team)
			return Response.json(
				{ error: 'Team not found' },
				{ status: 404, headers },
			)
		const body = (await req.json()) as { step?: number }
		if (typeof body.step !== 'number')
			return Response.json(
				{ error: 'Missing step index' },
				{ status: 400, headers },
			)
		const error = stopTeamStep(setupStopMatch.id, body.step)
		if (error) return Response.json({ error }, { status: 400, headers })
		return Response.json({ success: true }, { headers })
	}

	const setupStartMatch = matchRoute(path, '/v2/teams/:id/setup/start')
	if (setupStartMatch && method === 'POST') {
		const team = dbGetTeam(setupStartMatch.id)
		if (!team)
			return Response.json(
				{ error: 'Team not found' },
				{ status: 404, headers },
			)
		const body = (await req.json()) as { step?: number }
		if (typeof body.step !== 'number')
			return Response.json(
				{ error: 'Missing step index' },
				{ status: 400, headers },
			)
		const error = startTeamStep(setupStartMatch.id, body.step)
		if (error) return Response.json({ error }, { status: 400, headers })
		return Response.json({ success: true }, { headers })
	}

	return null
}
