import { getTeamPort, isPortActive } from '../../api/ports'
import { dbListAgentsByTeam } from '../../db/agents'
import { dbGetLatestLogByType } from '../../db/logs'
import { dbGetMetrics } from '../../db/metrics'
import { dbListTeams } from '../../db/teams'
import type { DashboardResult } from '../../types'

export function getDashboard(): DashboardResult {
	const teams = dbListTeams()
	const dashboard = teams.map(team => {
		const agents = dbListAgentsByTeam(team.id)
		const envReady = dbGetLatestLogByType(team.id, 'env:ready')
		let envInfo: Record<string, unknown> | null = null
		if (envReady) {
			try {
				envInfo = JSON.parse(envReady.payload)
			} catch {}
		}

		let behindMain = 0
		let lastCommit = ''
		try {
			const behind = Bun.spawnSync(
				['git', 'rev-list', 'HEAD..origin/main', '--count'],
				{ cwd: team.worktreePath },
			)
			behindMain = Number.parseInt(behind.stdout.toString().trim(), 10) || 0
		} catch {}
		try {
			const log = Bun.spawnSync(['git', 'log', '-1', '--format=%s'], {
				cwd: team.worktreePath,
			})
			lastCommit = log.stdout.toString().trim()
		} catch {}

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
	})
	const metrics = dbGetMetrics()
	return { teams: dashboard, metrics }
}

export function getConflicts() {
	const teams = dbListTeams()
	const conflicts: Record<string, Record<string, string[]>> = {}

	for (const team of teams) {
		const teamConflicts: Record<string, string[]> = {}
		try {
			const mergeBase = Bun.spawnSync(
				['git', 'merge-base', 'HEAD', 'origin/main'],
				{ cwd: team.worktreePath },
			)
			const base = mergeBase.stdout.toString().trim()
			if (base) {
				const check = Bun.spawnSync(
					['git', 'merge-tree', base, 'HEAD', 'origin/main'],
					{ cwd: team.worktreePath },
				)
				const output = check.stdout.toString()
				const files = parseConflictFiles(output)
				if (files.length > 0) teamConflicts.main = files
			}
		} catch {}

		for (const other of teams) {
			if (other.id === team.id) continue
			try {
				const branchName = `grove-team-${other.id}`
				const mergeBase = Bun.spawnSync(
					['git', 'merge-base', 'HEAD', `origin/${branchName}`],
					{ cwd: team.worktreePath },
				)
				const base = mergeBase.stdout.toString().trim()
				if (!base) continue
				const check = Bun.spawnSync(
					['git', 'merge-tree', base, 'HEAD', `origin/${branchName}`],
					{ cwd: team.worktreePath },
				)
				const output = check.stdout.toString()
				const files = parseConflictFiles(output)
				if (files.length > 0) teamConflicts[`team-${other.id}`] = files
			} catch {}
		}

		if (Object.keys(teamConflicts).length > 0) {
			conflicts[team.id] = teamConflicts
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
