import type { ServerWebSocket } from 'bun'
import {
	dbGetEventsSinceId,
	dbGetLatestEventId,
	dbListEventsSince,
} from '../db/events'
import type { TeamEvent, WsClientMessage, WsServerMessage } from '../types'

interface WsClientData {
	clientId: string
}

interface WsClient {
	ws: ServerWebSocket<WsClientData>
	deviceType: 'mac' | 'mobile' | null
	subscribedTeams: Set<string>
}

const clients = new Map<string, WsClient>()

export function broadcast(teamId: string, message: WsServerMessage) {
	for (const client of clients.values()) {
		if (client.subscribedTeams.has(teamId)) {
			try {
				client.ws.send(JSON.stringify(message))
			} catch {}
		}
	}
}

export function broadcastAll(message: WsServerMessage) {
	for (const client of clients.values()) {
		try {
			client.ws.send(JSON.stringify(message))
		} catch {}
	}
}

export const wsHandlers = {
	open(ws: ServerWebSocket<WsClientData>) {
		const clientId = Math.random().toString(36).slice(2)
		ws.data = { clientId }
		clients.set(clientId, { ws, deviceType: null, subscribedTeams: new Set() })
		ws.send(JSON.stringify({ type: 'connected' } satisfies WsServerMessage))
	},

	message(ws: ServerWebSocket<WsClientData>, raw: string | Buffer) {
		const client = clients.get(ws.data.clientId)
		if (!client) return
		try {
			const msg = JSON.parse(raw.toString()) as WsClientMessage
			if (msg.type === 'auth') {
				client.deviceType = msg.payload.deviceType
			} else if (msg.type === 'subscribe') {
				for (const teamId of msg.payload.teamIds) {
					client.subscribedTeams.add(teamId)
				}
			} else if (msg.type === 'replay') {
				const events = dbListEventsSince(msg.payload.teamId, msg.payload.since)
				ws.send(
					JSON.stringify({
						type: 'replay:batch',
						events,
					} satisfies WsServerMessage),
				)
			}
		} catch {}
	},

	close(ws: ServerWebSocket<WsClientData>) {
		clients.delete(ws.data.clientId)
	},
}

let lastSeenEventId = 0

export function startEventPoller() {
	lastSeenEventId = dbGetLatestEventId()
	setInterval(() => {
		const newEvents = dbGetEventsSinceId(lastSeenEventId)
		if (newEvents.length === 0) return
		lastSeenEventId = newEvents[newEvents.length - 1].id

		const byTeam = new Map<string, TeamEvent[]>()
		for (const event of newEvents) {
			const list = byTeam.get(event.teamId) ?? []
			list.push(event)
			byTeam.set(event.teamId, list)
		}
		for (const [teamId, events] of byTeam) {
			for (const event of events) {
				broadcast(teamId, {
					type: 'agent:event',
					teamId: event.teamId,
					agentId: event.agentId ?? '',
					role: 'dev',
					event: JSON.parse(event.payload),
				})
			}
		}
	}, 150)
}
