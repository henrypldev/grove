import { dbGetTeam } from '../../db/teams'
import { dbGetUsage } from '../../db/usage'

export async function handleV2Usage(
	req: Request,
	url: URL,
	headers: Record<string, string>,
): Promise<Response | null> {
	if (url.pathname !== '/v2/usage' || req.method !== 'GET') return null

	const period = url.searchParams.get('period') ?? 'day'
	const teamId = url.searchParams.get('teamId') ?? undefined
	const repoId = url.searchParams.get('repoId') ?? undefined

	let since: number
	if (period === 'session') {
		if (!teamId) {
			return Response.json(
				{ error: 'teamId required for session period' },
				{ status: 400, headers },
			)
		}
		const team = dbGetTeam(teamId)
		if (!team) {
			return Response.json(
				{ error: 'Team not found' },
				{ status: 404, headers },
			)
		}
		since = team.createdAt
	} else if (period === 'week') {
		since = Date.now() - 604800000
	} else if (period === 'month') {
		since = Date.now() - 2592000000
	} else {
		since = Date.now() - 86400000
	}

	const rows = dbGetUsage({ teamId, repoId, since })

	let totalInputTokens = 0
	let totalOutputTokens = 0
	let totalCacheReadTokens = 0
	let totalCacheCreationTokens = 0
	let totalNumTurns = 0
	let totalDurationMs = 0
	let totalDurationApiMs = 0
	const byModel: Record<
		string,
		{ inputTokens: number; outputTokens: number; costUsd: number }
	> = {}
	const byDay: Record<
		string,
		{
			inputTokens: number
			outputTokens: number
			cacheReadTokens: number
			cacheCreationTokens: number
			numTurns: number
		}
	> = {}

	for (const row of rows) {
		totalInputTokens += row.inputTokens
		totalOutputTokens += row.outputTokens
		totalCacheReadTokens += row.cacheReadTokens
		totalCacheCreationTokens += row.cacheCreationTokens
		totalNumTurns += row.numTurns
		totalDurationMs += row.durationMs
		totalDurationApiMs += row.durationApiMs

		if (!byModel[row.model]) {
			byModel[row.model] = { inputTokens: 0, outputTokens: 0, costUsd: 0 }
		}
		byModel[row.model].inputTokens += row.inputTokens
		byModel[row.model].outputTokens += row.outputTokens
		byModel[row.model].costUsd += row.costUsd

		const day = new Date(row.createdAt).toISOString().slice(0, 10)
		if (!byDay[day]) {
			byDay[day] = {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheCreationTokens: 0,
				numTurns: 0,
			}
		}
		byDay[day].inputTokens += row.inputTokens
		byDay[day].outputTokens += row.outputTokens
		byDay[day].cacheReadTokens += row.cacheReadTokens
		byDay[day].cacheCreationTokens += row.cacheCreationTokens
		byDay[day].numTurns += row.numTurns
	}

	const count = rows.length || 1
	return Response.json(
		{
			totalInputTokens,
			totalOutputTokens,
			totalCacheReadTokens,
			totalCacheCreationTokens,
			totalNumTurns,
			avgDurationMs: Math.round(totalDurationMs / count),
			avgDurationApiMs: Math.round(totalDurationApiMs / count),
			byModel,
			byDay,
		},
		{ headers },
	)
}
