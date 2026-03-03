import type { WsClientMessage, WsServerMessage } from '@usegrove/shared'
import { TypedEmitter } from './events'
import { GroveRestClient } from './rest'
import { buildRpcNamespaces, type RpcNamespaces } from './rpc'
import type {
	ConnectionStatus,
	GroveClientOptions,
	RpcMethods,
	ServerEventMap,
} from './types'

export class GroveClient extends TypedEmitter<ServerEventMap> {
	private ws: WebSocket | null = null
	private options: Required<GroveClientOptions>
	private _status: ConnectionStatus = 'disconnected'
	private channels = new Set<string>()
	private pendingRpc = new Map<
		string,
		{
			resolve: (data: any) => void
			reject: (err: Error) => void
			timer: ReturnType<typeof setTimeout>
		}
	>()
	private rpcCounter = 0
	private reconnectAttempt = 0
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null
	private pingTimer: ReturnType<typeof setInterval> | null = null
	private pongReceived = true

	// Namespaced RPC methods
	readonly version: RpcNamespaces['version']
	readonly config: RpcNamespaces['config']
	readonly github: RpcNamespaces['github']
	readonly repos: RpcNamespaces['repos']
	readonly scripts: RpcNamespaces['scripts']
	readonly teams: RpcNamespaces['teams']
	readonly dashboard: RpcNamespaces['dashboard']
	readonly conflicts: RpcNamespaces['conflicts']
	readonly usage: RpcNamespaces['usage']
	readonly activity: RpcNamespaces['activity']

	// REST client
	readonly rest: GroveRestClient

	constructor(options: GroveClientOptions) {
		super()
		this.options = {
			url: options.url,
			deviceType: options.deviceType ?? 'mac',
			autoReconnect: options.autoReconnect ?? true,
			reconnectMaxRetries: options.reconnectMaxRetries ?? 10,
			reconnectBaseDelay: options.reconnectBaseDelay ?? 1000,
			pingInterval: options.pingInterval ?? 30_000,
			rpcTimeout: options.rpcTimeout ?? 30_000,
		}

		// Build RPC namespaces
		const ns = buildRpcNamespaces((method, params) =>
			this.rpc(method, params),
		)
		this.version = ns.version
		this.config = ns.config
		this.github = ns.github
		this.repos = ns.repos
		this.scripts = ns.scripts
		this.teams = ns.teams
		this.dashboard = ns.dashboard
		this.conflicts = ns.conflicts
		this.usage = ns.usage
		this.activity = ns.activity

		// REST client
		this.rest = new GroveRestClient(this.options.url)
	}

	get status(): ConnectionStatus {
		return this._status
	}

	connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (this.ws) {
				resolve()
				return
			}

			this._status = 'connecting'
			this.ws = new WebSocket(this.options.url)

			const onOpen = () => {
				this._status = 'connected'
				this.reconnectAttempt = 0
				this.send({
					type: 'auth',
					payload: { deviceType: this.options.deviceType },
				})

				// Re-subscribe to channels
				if (this.channels.size > 0) {
					this.send({
						type: 'subscribe',
						channels: [...this.channels],
					})
				}

				this.startPing()
				resolve()
			}

			const onError = () => {
				if (this._status === 'connecting') {
					reject(new Error('WebSocket connection failed'))
				}
			}

			this.ws.onopen = onOpen
			this.ws.onerror = onError
			this.ws.onmessage = (event) => this.handleMessage(event)
			this.ws.onclose = () => this.handleClose()
		})
	}

	disconnect(): void {
		this.options.autoReconnect = false
		this.cleanup()
	}

	subscribe(channels: string[]): void {
		for (const ch of channels) {
			this.channels.add(ch)
		}
		if (this._status === 'connected') {
			this.send({ type: 'subscribe', channels })
		}
	}

	unsubscribe(channels: string[]): void {
		for (const ch of channels) {
			this.channels.delete(ch)
		}
		if (this._status === 'connected') {
			this.send({ type: 'unsubscribe', channels })
		}
	}

	replay(params: { channel: string; sinceId: number }): void {
		this.send({
			type: 'replay',
			channel: params.channel,
			sinceId: params.sinceId,
		})
	}

	private rpc<M extends keyof RpcMethods>(
		method: M,
		params: RpcMethods[M]['params'],
	): Promise<RpcMethods[M]['result']> {
		return new Promise((resolve, reject) => {
			if (this._status !== 'connected') {
				reject(new Error('Not connected'))
				return
			}

			const id = `rpc_${++this.rpcCounter}_${Date.now()}`
			const timer = setTimeout(() => {
				this.pendingRpc.delete(id)
				reject(new Error(`RPC timeout: ${method}`))
			}, this.options.rpcTimeout)

			this.pendingRpc.set(id, { resolve, reject, timer })
			this.send({
				type: 'rpc',
				id,
				method: method as string,
				params: params as Record<string, unknown>,
			})
		})
	}

	private send(msg: WsClientMessage): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(msg))
		}
	}

	private handleMessage(event: MessageEvent): void {
		try {
			const msg = JSON.parse(event.data as string) as WsServerMessage

			switch (msg.type) {
				case 'connected':
					this.emit('connected')
					break
				case 'pong':
					this.pongReceived = true
					break
				case 'rpc:response': {
					const pending = this.pendingRpc.get(msg.id)
					if (pending) {
						clearTimeout(pending.timer)
						this.pendingRpc.delete(msg.id)
						if (msg.error) {
							pending.reject(new Error(msg.error))
						} else {
							pending.resolve(msg.data)
						}
					}
					break
				}
				case 'activity':
					this.emit('activity', msg.data, msg.channel)
					break
				case 'log':
					this.emit('log', msg.data, msg.channel)
					break
				case 'team:update':
					this.emit('team:update', msg.data, msg.channel)
					break
				case 'agent:update':
					this.emit('agent:update', msg.data, msg.channel)
					break
				case 'replay:batch':
					this.emit('replay:batch', msg.activity, msg.channel)
					break
			}
		} catch {
			// Ignore malformed messages
		}
	}

	private handleClose(): void {
		this.stopPing()
		const wasConnected = this._status === 'connected'
		this._status = 'disconnected'

		// Reject pending RPCs
		for (const [, pending] of this.pendingRpc) {
			clearTimeout(pending.timer)
			pending.reject(new Error('Connection closed'))
		}
		this.pendingRpc.clear()

		if (wasConnected) {
			this.emit('disconnected')
		}

		if (
			this.options.autoReconnect &&
			this.reconnectAttempt < this.options.reconnectMaxRetries
		) {
			this.scheduleReconnect()
		}
	}

	private scheduleReconnect(): void {
		const delay =
			this.options.reconnectBaseDelay *
			Math.pow(2, this.reconnectAttempt)
		this.reconnectAttempt++
		this.emit('reconnecting', this.reconnectAttempt)

		this.reconnectTimer = setTimeout(() => {
			this.ws = null
			this.connect().catch(() => {})
		}, delay)
	}

	private startPing(): void {
		this.stopPing()
		this.pongReceived = true
		this.pingTimer = setInterval(() => {
			if (!this.pongReceived) {
				this.ws?.close()
				return
			}
			this.pongReceived = false
			this.send({ type: 'ping' })
		}, this.options.pingInterval)
	}

	private stopPing(): void {
		if (this.pingTimer) {
			clearInterval(this.pingTimer)
			this.pingTimer = null
		}
	}

	private cleanup(): void {
		this.stopPing()
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}
		for (const [, pending] of this.pendingRpc) {
			clearTimeout(pending.timer)
			pending.reject(new Error('Client disconnected'))
		}
		this.pendingRpc.clear()
		if (this.ws) {
			this.ws.onopen = null
			this.ws.onmessage = null
			this.ws.onerror = null
			this.ws.onclose = null
			this.ws.close()
			this.ws = null
		}
		this._status = 'disconnected'
	}
}
