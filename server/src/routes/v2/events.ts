import { popAgentTools } from '../../agents/runner'
import { dbGetAgent } from '../../db/agents'
import { dbInsertEvent, subscribeToGlobalEvents } from '../../db/events'
import { dbGetTeam } from '../../db/teams'

export async function handleV2Events(
	req: Request,
	url: URL,
	headers: Record<string, string>,
): Promise<Response | null> {
	const path = url.pathname
	const method = req.method

	if (path === '/v2/events' && method === 'GET') {
		const enc = new TextEncoder()
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(enc.encode('data: {"type":"connected"}\n\n'))
				const unsub = subscribeToGlobalEvents(event => {
					try {
						controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`))
					} catch {}
				})
				req.signal.addEventListener('abort', () => unsub())
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

	if (path === '/v2/events' && method === 'POST') {
		const body = (await req.json()) as {
			teamId: string
			agentId: string
			type: string
			payload: Record<string, unknown>
		}
		if (!body.teamId || !body.agentId || !body.type || !body.payload) {
			return Response.json(
				{ error: 'Missing required fields' },
				{ status: 400, headers },
			)
		}
		const team = dbGetTeam(body.teamId)
		if (!team)
			return Response.json(
				{ error: 'Team not found' },
				{ status: 404, headers },
			)
		const agent = dbGetAgent(body.agentId)
		if (!agent)
			return Response.json(
				{ error: 'Agent not found' },
				{ status: 404, headers },
			)

		if (body.type === 'agent:message') {
			body.payload = {
				...body.payload,
				tools: popAgentTools(body.agentId),
			}
		}

		const event = dbInsertEvent(
			body.teamId,
			body.agentId,
			body.type,
			body.payload,
		)
		return Response.json(event, { headers })
	}

	return null
}
