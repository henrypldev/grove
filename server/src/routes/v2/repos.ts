import {
	cloneRepo,
	getGitHubOrgs,
	getGitHubRepos,
	getOrgRepos,
} from '../../api/github'
import { addRepo, withSetupFile } from '../../api/repos'
import { listDirectories } from '../../config'
import {
	dbDeleteRepo,
	dbGetRepo,
	dbInsertRepo,
	dbListRepos,
} from '../../db/repos'
import { dbListTeamsByRepo } from '../../db/teams'

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

export async function handleV2Repos(
	req: Request,
	url: URL,
	headers: Record<string, string>,
): Promise<Response | null> {
	const path = url.pathname
	const method = req.method

	if (path === '/v2/config/list-directories' && method === 'GET') {
		const queryPath = url.searchParams.get('path') ?? '/'
		const dirs = listDirectories(queryPath)
		return Response.json({ directories: dirs }, { headers })
	}

	if (path === '/v2/github/repos' && method === 'GET') {
		return Response.json({ repos: await getGitHubRepos() }, { headers })
	}

	if (path === '/v2/github/repos/orgs' && method === 'GET') {
		return Response.json({ orgs: await getGitHubOrgs() }, { headers })
	}

	const orgReposMatch = matchRoute(path, '/v2/github/repos/orgs/:org')
	if (orgReposMatch && method === 'GET') {
		return Response.json(
			{ repos: await getOrgRepos(orgReposMatch.org) },
			{ headers },
		)
	}

	if (path === '/v2/repos' && method === 'GET') {
		return Response.json(dbListRepos(), { headers })
	}

	if (path === '/v2/repos' && method === 'POST') {
		const body = await req.json()
		const repo = await addRepo(body.path)
		if (typeof repo === 'string')
			return Response.json({ error: repo }, { status: 400, headers })
		dbInsertRepo(repo)
		return Response.json(withSetupFile(repo), { headers })
	}

	if (path === '/v2/repos/clone' && method === 'POST') {
		const body = await req.json()
		const repo = await cloneRepo(body.fullName)
		if (typeof repo === 'string')
			return Response.json({ error: repo }, { status: 400, headers })
		dbInsertRepo(repo)
		return Response.json(withSetupFile(repo), { headers })
	}

	const repoMatch = matchRoute(path, '/v2/repos/:id')
	if (repoMatch && method === 'DELETE') {
		const deleted = dbDeleteRepo(repoMatch.id)
		if (!deleted)
			return Response.json(
				{ error: 'Repo not found' },
				{ status: 404, headers },
			)
		return Response.json({ success: true }, { headers })
	}

	const repoTeamsMatch = matchRoute(path, '/v2/repos/:id/teams')
	if (repoTeamsMatch && method === 'GET') {
		const repo = dbGetRepo(repoTeamsMatch.id)
		if (!repo)
			return Response.json(
				{ error: 'Repo not found' },
				{ status: 404, headers },
			)
		const teams = dbListTeamsByRepo(repoTeamsMatch.id)
		return Response.json(teams, { headers })
	}

	return null
}
