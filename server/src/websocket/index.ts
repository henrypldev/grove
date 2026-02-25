import type { ServerWebSocket } from 'bun'
import {
	dbGetEventsSinceId,
	dbListEventsSince,
	subscribeToGlobalEvents,
	subscribeToTeamEvents,
} from '../db/events'
import type { TeamEvent, WsClientMessage, WsServerMessage } from '../types'

interface WsClientData {
	clientId: string
}

interface WsClient {
	ws: ServerWebSocket<WsClientData>
	deviceType: 'mac' | 'mobile' | null
	channels: Set<string>
}

const clients = new Map<string, WsClient>()
const teamUnsubscribers = new Map<string, () => void>()

export function broadcastToChannel(channel: string, message: WsServerMessage) {
	for (const client of clients.values()) {
		if (client.channels.has(channel)) {
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

function hasSubscribers(channel: string): boolean {
	for (const client of clients.values()) {
		if (client.channels.has(channel)) return true
	}
	return false
}

function ensureTeamListener(teamId: string) {
	if (teamUnsubscribers.has(teamId)) return
	const unsub = subscribeToTeamEvents(teamId, (event: TeamEvent) => {
		broadcastToChannel(`team:${teamId}`, {
			type: 'event',
			channel: `team:${teamId}`,
			data: event,
		})
	})
	teamUnsubscribers.set(teamId, unsub)
}

function maybeRemoveTeamListener(teamId: string) {
	if (hasSubscribers(`team:${teamId}`)) return
	const unsub = teamUnsubscribers.get(teamId)
	if (unsub) {
		unsub()
		teamUnsubscribers.delete(teamId)
	}
}

export const wsHandlers = {
	open(ws: ServerWebSocket<WsClientData>) {
		const clientId = Math.random().toString(36).slice(2)
		ws.data = { clientId }
		clients.set(clientId, { ws, deviceType: null, channels: new Set() })
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
				for (const channel of msg.channels) {
					client.channels.add(channel)
					if (channel.startsWith('team:')) {
						ensureTeamListener(channel.slice(5))
					}
				}
			} else if (msg.type === 'unsubscribe') {
				for (const channel of msg.channels) {
					client.channels.delete(channel)
					if (channel.startsWith('team:')) {
						maybeRemoveTeamListener(channel.slice(5))
					}
				}
			} else if (msg.type === 'replay') {
				const channel = msg.channel
				if (channel.startsWith('team:')) {
					const teamId = channel.slice(5)
					const events = dbGetEventsSinceId(msg.sinceId).filter(
						e => e.teamId === teamId,
					)
					ws.send(
						JSON.stringify({
							type: 'replay:batch',
							channel,
							events,
						} satisfies WsServerMessage),
					)
				}
			} else if (msg.type === 'ping') {
				ws.send(JSON.stringify({ type: 'pong' } satisfies WsServerMessage))
			}
		} catch {}
	},

	close(ws: ServerWebSocket<WsClientData>) {
		const client = clients.get(ws.data.clientId)
		if (client) {
			for (const channel of client.channels) {
				if (channel.startsWith('team:')) {
					client.channels.delete(channel)
					maybeRemoveTeamListener(channel.slice(5))
				}
			}
		}
		clients.delete(ws.data.clientId)
	},
}

let globalUnsub: (() => void) | null = null

export function initWebSocketBridge() {
	if (globalUnsub) return
	globalUnsub = subscribeToGlobalEvents(event => {
		broadcastToChannel('global', {
			type: 'event',
			channel: 'global',
			data: event as unknown as TeamEvent,
		})
	})
}
