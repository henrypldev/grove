import { popAgentTools } from '../../agents/runner'
import { dbInsertActivity } from '../../db/activity'
import { dbGetAgent } from '../../db/agents'
import { dbGetTeam } from '../../db/teams'

export async function insertActivity(params: {
	teamId: string
	agentId: string
	type: string
	payload: Record<string, unknown>
}) {
	if (!params.teamId || !params.agentId || !params.type || !params.payload) {
		return { error: 'Missing required fields' }
	}
	const team = dbGetTeam(params.teamId)
	if (!team) return { error: 'Team not found' }
	const agent = dbGetAgent(params.agentId)
	if (!agent) return { error: 'Agent not found' }

	let payload = params.payload
	if (params.type === 'agent:message') {
		payload = {
			...payload,
			tools: popAgentTools(params.agentId),
		}
	}

	const item = dbInsertActivity(
		params.teamId,
		params.agentId,
		params.type,
		payload,
	)
	return item
}

export async function handleV2Activity(
	req: Request,
	url: URL,
	headers: Record<string, string>,
): Promise<Response | null> {
	const path = url.pathname
	const method = req.method

	if (path === '/v2/activity' && method === 'POST') {
		const body = (await req.json()) as {
			teamId: string
			agentId: string
			type: string
			payload: Record<string, unknown>
		}
		const result = await insertActivity(body)
		if ('error' in result) {
			const status = result.error === 'Missing required fields' ? 400 : 404
			return Response.json(result, { status, headers })
		}
		return Response.json(result, { headers })
	}

	return null
}
