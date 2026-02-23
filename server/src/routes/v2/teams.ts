import { createWorktree } from '../../api/worktrees'
import { generateId } from '../../config'
import { dbGetAgent, dbListAgentsByTeam } from '../../db/agents'
import {
	dbInsertEvent,
	dbListEventsSince,
	subscribeToTeamEvents,
} from '../../db/events'
import { dbGetRepo } from '../../db/repos'
import {
	dbArchiveTeam,
	dbGetTeam,
	dbInsertTeam,
	dbListTeams,
	dbUpdateTeamTitle,
} from '../../db/teams'
import type { Team } from '../../types'

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

export let onTeamCreated: ((team: Team) => Promise<void>) | null = null
export function setTeamCreatedHook(hook: (team: Team) => Promise<void>) {
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
		const body = (await req.json()) as { repoId: string; task: string }
		if (!body.repoId || !body.task) {
			return Response.json(
				{ error: 'Missing repoId or task' },
				{ status: 400, headers },
			)
		}
		const repo = dbGetRepo(body.repoId)
		if (!repo)
			return Response.json(
				{ error: 'Repo not found' },
				{ status: 404, headers },
			)

		const teamId = generateId()
		const branch = `grove-team-${teamId}`
		const worktree = await createWorktree(body.repoId, branch, 'main')
		if (typeof worktree === 'string') {
			return Response.json({ error: worktree }, { status: 400, headers })
		}

		const now = Date.now()
		const team: Team = {
			id: teamId,
			repoId: body.repoId,
			worktreePath: worktree.path,
			task: body.task,
			title: null,
			status: 'planning',
			pmSummary: null,
			port: null,
			createdAt: now,
			updatedAt: now,
		}
		dbInsertTeam(team)

		import('../../agents/title').then(({ generateTeamTitle }) =>
			generateTeamTitle(body.task).then(title =>
				dbUpdateTeamTitle(teamId, title),
			),
		)

		if (onTeamCreated) await onTeamCreated(team)

		return Response.json(team, { headers })
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
			return Response.json({ ...team, agents }, { headers })
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
				spawnEnvAgent,
			} = await import('../../agents/specialists')
			let agent
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
				case 'env':
					agent = await spawnEnvAgent(team)
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
		const body = (await req.json()) as { text?: string }
		if (!body.text)
			return Response.json({ error: 'Missing text' }, { status: 400, headers })
		const event = dbInsertEvent(team.id, null, 'user:message', {
			text: body.text,
		})
		const { routeMessageToAgents } = await import('../../agents/orchestrator')
		await routeMessageToAgents(team, body.text)
		return Response.json(event, { headers })
	}

	const eventsMatch = matchRoute(path, '/v2/teams/:id/events')
	if (eventsMatch && method === 'GET') {
		const since = Number(url.searchParams.get('since') ?? '0')
		const events = dbListEventsSince(eventsMatch.id, since)
		return Response.json(events, { headers })
	}

	const streamMatch = matchRoute(path, '/v2/teams/:id/stream')
	if (streamMatch && method === 'GET') {
		const team = dbGetTeam(streamMatch.id)
		if (!team)
			return Response.json(
				{ error: 'Team not found' },
				{ status: 404, headers },
			)
		const since = Number(url.searchParams.get('since') ?? '-1')
		const enc = new TextEncoder()
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(enc.encode('data: {"type":"connected"}\n\n'))
				if (since >= 0) {
					for (const event of dbListEventsSince(streamMatch.id, since)) {
						controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`))
					}
				}
				const unsubscribe = subscribeToTeamEvents(streamMatch.id, event => {
					try {
						controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`))
					} catch {}
				})
				req.signal.addEventListener('abort', () => {
					unsubscribe()
				})
			},
		})
		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
				'Access-Control-Allow-Origin': '*',
			},
		})
	}

	return null
}
