import type { ServerWebSocket } from 'bun'
import {
	handleSimulatorClose,
	handleSimulatorMessage,
	handleSimulatorOpen,
	SIMULATOR_MAX_PAYLOAD,
	type SimulatorWsData,
} from '../api/simulator-relay'
import { getTeamDeviceUdid } from '../api/simulator'
import { log } from '../config'
import {
	dbGetActivitySinceIdForTeam,
	subscribeToGlobalActivity,
	subscribeToTeamActivity,
} from '../db/activity'
import { subscribeToTeamLogs } from '../db/logs'
import type {
	TeamActivity,
	TeamLog,
	WsClientMessage,
	WsServerMessage,
} from '../types'
import { handleRpc } from './rpc'

type WsClientData = { type?: undefined; clientId: string } | SimulatorWsData

interface WsClient {
	ws: ServerWebSocket<WsClientData>
	deviceType: 'mac' | 'mobile' | null
	channels: Set<string>
}

const clients = new Map<string, WsClient>()
const teamUnsubscribers = new Map<string, () => void>()
const teamLogUnsubscribers = new Map<string, () => void>()

export function broadcastToChannel(channel: string, message: WsServerMessage) {
	const serialized = JSON.stringify(message)
	for (const client of clients.values()) {
		if (client.channels.has(channel)) {
			try {
				client.ws.send(serialized)
			} catch {}
		}
	}
}

export function broadcastAll(message: WsServerMessage) {
	const serialized = JSON.stringify(message)
	for (const client of clients.values()) {
		try {
			client.ws.send(serialized)
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
	if (!teamUnsubscribers.has(teamId)) {
		const unsub = subscribeToTeamActivity(teamId, (item: TeamActivity) => {
			broadcastToChannel(`team:${teamId}`, {
				type: 'activity',
				channel: `team:${teamId}`,
				data: item,
			})
		})
		teamUnsubscribers.set(teamId, unsub)
	}
	if (!teamLogUnsubscribers.has(teamId)) {
		const unsub = subscribeToTeamLogs(teamId, (log: TeamLog) => {
			broadcastToChannel(`team:${teamId}`, {
				type: 'log',
				channel: `team:${teamId}`,
				data: log,
			})
		})
		teamLogUnsubscribers.set(teamId, unsub)
	}
}

function maybeRemoveTeamListener(teamId: string) {
	if (hasSubscribers(`team:${teamId}`)) return
	const unsub = teamUnsubscribers.get(teamId)
	if (unsub) {
		unsub()
		teamUnsubscribers.delete(teamId)
	}
	const logUnsub = teamLogUnsubscribers.get(teamId)
	if (logUnsub) {
		logUnsub()
		teamLogUnsubscribers.delete(teamId)
	}
}

export const wsHandlers = {
	maxPayloadLength: SIMULATOR_MAX_PAYLOAD,

	open(ws: ServerWebSocket<WsClientData>) {
		if (ws.data.type === 'simulator') {
			handleSimulatorOpen(ws as ServerWebSocket<SimulatorWsData>)
			return
		}
		const clientId = Math.random().toString(36).slice(2)
		ws.data = { clientId }
		clients.set(clientId, {
			ws: ws as ServerWebSocket<{ clientId: string }>,
			deviceType: null,
			channels: new Set(),
		})
		log('ws', `open ${clientId}`)
		ws.send(JSON.stringify({ type: 'connected' } satisfies WsServerMessage))
	},

	async message(ws: ServerWebSocket<WsClientData>, raw: string | Buffer) {
		if (ws.data.type === 'simulator') {
			handleSimulatorMessage(ws as ServerWebSocket<SimulatorWsData>, raw)
			return
		}
		const client = clients.get(ws.data.clientId)
		if (!client) return
		try {
			const msg = JSON.parse(raw.toString()) as WsClientMessage
			log('ws', `message ${ws.data.clientId} ${msg.type}`)
			if (msg.type === 'auth') {
				client.deviceType = msg.payload.deviceType
			} else if (msg.type === 'subscribe') {
				for (const channel of msg.channels) {
					client.channels.add(channel)
					if (channel.startsWith('team:')) {
						const teamId = channel.slice(5)
						ensureTeamListener(teamId)
						// Send current simulator state so clients that
						// subscribed after simulator:ready don't miss it
						const simUdid = getTeamDeviceUdid(teamId)
						if (simUdid) {
							try {
								ws.send(
									JSON.stringify({
										type: 'log',
										channel,
										data: {
											id: 0,
											teamId,
											type: 'simulator:ready',
											payload: JSON.stringify({
												udid: simUdid,
												name: `grove-team-${teamId}`,
											}),
											createdAt: Date.now(),
										},
									} satisfies WsServerMessage),
								)
							} catch {}
						}
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
					const items = dbGetActivitySinceIdForTeam(msg.sinceId, teamId)
					ws.send(
						JSON.stringify({
							type: 'replay:batch',
							channel,
							activity: items,
						} satisfies WsServerMessage),
					)
				}
			} else if (msg.type === 'ping') {
				ws.send(JSON.stringify({ type: 'pong' } satisfies WsServerMessage))
			} else if (msg.type === 'rpc') {
				await handleRpc(ws, msg)
			}
		} catch {}
	},

	close(ws: ServerWebSocket<WsClientData>) {
		if (ws.data.type === 'simulator') {
			handleSimulatorClose(ws as ServerWebSocket<SimulatorWsData>)
			return
		}
		log('ws', `close ${ws.data.clientId}`)
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
	globalUnsub = subscribeToGlobalActivity(item => {
		broadcastToChannel('global', {
			type: 'activity',
			channel: 'global',
			data: item as unknown as TeamActivity,
		})
	})
}
