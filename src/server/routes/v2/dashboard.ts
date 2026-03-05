import { getTeamPort, isPortActive } from '../../api/ports'
import { dbListAllAgents } from '../../db/agents'
import { dbGetLatestLogByType } from '../../db/logs'
import { dbGetMetrics } from '../../db/metrics'
import { dbListTeams } from '../../db/teams'
import type { DashboardResult } from '../../types'

const lastFetchByRepo = new Map<string, number>()
const FETCH_TTL_MS = 30_000

async function gitText(args: string[], cwd: string): Promise<string> {
	try {
		const proc = Bun.spawn(args, { cwd, stdout: 'pipe' })
		const text = await new Response(proc.stdout).text()
		await proc.exited
		return text.trim()
	} catch {
		return ''
	}
}

export async function getDashboard(): Promise<DashboardResult> {
	const teams = dbListTeams()
	const allAgents = dbListAllAgents()
	const agentsByTeam = new Map<string, typeof allAgents>()
	for (const agent of allAgents) {
		const list = agentsByTeam.get(agent.teamId)
		if (list) {
			list.push(agent)
		} else {
			agentsByTeam.set(agent.teamId, [agent])
		}
	}

	// Fetch origin/main once per repo (with TTL) so rev-list comparisons are current
	const now = Date.now()
	const reposToFetch = new Map<string, string>()
	for (const team of teams) {
		if (!reposToFetch.has(team.repoId)) {
			const last = lastFetchByRepo.get(team.repoId) ?? 0
			if (now - last > FETCH_TTL_MS) {
				reposToFetch.set(team.repoId, team.worktreePath)
			}
		}
	}
	await Promise.all(
		Array.from(reposToFetch.entries()).map(async ([repoId, cwd]) => {
			await gitText(['git', 'fetch', 'origin', 'main'], cwd)
			lastFetchByRepo.set(repoId, Date.now())
		}),
	)

	const dashboard = await Promise.all(
		teams.map(async team => {
			const agents = agentsByTeam.get(team.id) ?? []
			const envReady = dbGetLatestLogByType(team.id, 'env:ready')
			let envInfo: Record<string, unknown> | null = null
			if (envReady) {
				try {
					envInfo = JSON.parse(envReady.payload)
				} catch {}
			}

			const [behindText, lastCommit] = await Promise.all([
				gitText(
					['git', 'rev-list', 'HEAD..origin/main', '--count'],
					team.worktreePath,
				),
				gitText(['git', 'log', '-1', '--format=%s'], team.worktreePath),
			])
			const behindMain = Number.parseInt(behindText, 10) || 0

			const port = getTeamPort(team.id)
			return {
				id: team.id,
				title: team.title,
				status: team.status,
				repoId: team.repoId,
				port: port && isPortActive(port) ? port : null,
				agents: agents.map(a => ({
					id: a.id,
					role: a.role,
					status: a.status,
					activity: a.activity,
				})),
				env: envInfo,
				behindMain,
				lastCommit,
			}
		}),
	)
	const metrics = dbGetMetrics()
	return { teams: dashboard, metrics }
}

export async function getConflicts() {
	const teams = dbListTeams()
	const results = await Promise.all(
		teams.map(async team => {
			const teamConflicts: Record<string, string[]> = {}

			// Check conflicts with main
			const mainBase = await gitText(
				['git', 'merge-base', 'HEAD', 'origin/main'],
				team.worktreePath,
			)
			if (mainBase) {
				const output = await gitText(
					['git', 'merge-tree', mainBase, 'HEAD', 'origin/main'],
					team.worktreePath,
				)
				const files = parseConflictFiles(output)
				if (files.length > 0) teamConflicts.main = files
			}

			// Check conflicts with other teams in parallel
			const otherTeams = teams.filter(t => t.id !== team.id)
			const otherResults = await Promise.all(
				otherTeams.map(async other => {
					const branchName = `grove-team-${other.id}`
					const base = await gitText(
						['git', 'merge-base', 'HEAD', `origin/${branchName}`],
						team.worktreePath,
					)
					if (!base) return null
					const output = await gitText(
						['git', 'merge-tree', base, 'HEAD', `origin/${branchName}`],
						team.worktreePath,
					)
					const files = parseConflictFiles(output)
					if (files.length > 0) {
						return { key: `team-${other.id}`, files }
					}
					return null
				}),
			)

			for (const result of otherResults) {
				if (result) teamConflicts[result.key] = result.files
			}

			return { teamId: team.id, teamConflicts }
		}),
	)

	const conflicts: Record<string, Record<string, string[]>> = {}
	for (const { teamId, teamConflicts } of results) {
		if (Object.keys(teamConflicts).length > 0) {
			conflicts[teamId] = teamConflicts
		}
	}
	return conflicts
}

export async function handleV2Dashboard(
	req: Request,
	url: URL,
	headers: Record<string, string>,
): Promise<Response | null> {
	const path = url.pathname
	const method = req.method

	if (path === '/v2/dashboard' && method === 'GET') {
		return Response.json(await getDashboard(), { headers })
	}

	if (path === '/v2/conflicts' && method === 'GET') {
		return Response.json(await getConflicts(), { headers })
	}

	return null
}

function parseConflictFiles(mergeTreeOutput: string): string[] {
	const files: string[] = []
	for (const line of mergeTreeOutput.split('\n')) {
		if (line.includes('CONFLICT')) {
			const match = line.match(/CONFLICT \([^)]+\): (.+)/)
			if (match) files.push(match[1].trim())
		}
	}
	return files
}
