import { createWorktree } from '../../api/worktrees'
import { generateId } from '../../config'
import { dbListAgentsByTeam } from '../../db/agents'
import { dbListEventsSince } from '../../db/events'
import { dbGetRepo } from '../../db/repos'
import {
	dbArchiveTeam,
	dbGetTeam,
	dbInsertTeam,
	dbListTeams,
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
			status: 'planning',
			pmSummary: null,
			createdAt: now,
			updatedAt: now,
		}
		dbInsertTeam(team)

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
	if (agentsMatch && method === 'GET') {
		const team = dbGetTeam(agentsMatch.id)
		if (!team)
			return Response.json(
				{ error: 'Team not found' },
				{ status: 404, headers },
			)
		return Response.json(dbListAgentsByTeam(agentsMatch.id), { headers })
	}

	const respawnMatch = matchRoute(
		path,
		'/v2/teams/:teamId/agents/:agentId/respawn',
	)
	if (respawnMatch && method === 'POST') {
		return Response.json({ success: true }, { headers })
	}

	const eventsMatch = matchRoute(path, '/v2/teams/:id/events')
	if (eventsMatch && method === 'GET') {
		const since = Number(url.searchParams.get('since') ?? '0')
		const events = dbListEventsSince(eventsMatch.id, since)
		return Response.json(events, { headers })
	}

	return null
}
