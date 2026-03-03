import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { GroveClient } from '../client'

// Mock WebSocket that captures messages and simulates server behavior
class MockWebSocket {
	static OPEN = 1
	static CLOSED = 3
	readyState = MockWebSocket.OPEN
	sent: string[] = []
	onopen: (() => void) | null = null
	onclose: (() => void) | null = null
	onmessage: ((event: { data: string }) => void) | null = null
	onerror: (() => void) | null = null

	send(data: string) {
		this.sent.push(data)
	}

	close() {
		this.readyState = MockWebSocket.CLOSED
		this.onclose?.()
	}

	// Test helper: simulate server message
	simulateMessage(data: unknown) {
		this.onmessage?.({ data: JSON.stringify(data) })
	}
}

let mockWs: MockWebSocket
let savedWebSocket: typeof globalThis.WebSocket

describe('GroveClient', () => {
	beforeEach(() => {
		savedWebSocket = globalThis.WebSocket
		mockWs = new MockWebSocket()
		const MockWSClass = class {
			static CONNECTING = 0
			static OPEN = 1
			static CLOSING = 2
			static CLOSED = 3
			constructor() {
				setTimeout(() => mockWs.onopen?.(), 0)
				return mockWs as any
			}
		}
		;(globalThis as any).WebSocket = MockWSClass
	})

	afterEach(() => {
		globalThis.WebSocket = savedWebSocket
	})

	test('connect sends auth message', async () => {
		const client = new GroveClient({ url: 'ws://localhost:3000/ws', autoReconnect: false, pingInterval: 999999 })
		await client.connect()
		const authMsg = JSON.parse(mockWs.sent[0])
		expect(authMsg.type).toBe('auth')
		expect(authMsg.payload.deviceType).toBe('mac')
		client.disconnect()
	})

	test('status transitions through connecting to connected', async () => {
		const client = new GroveClient({ url: 'ws://localhost:3000/ws', autoReconnect: false, pingInterval: 999999 })
		expect(client.status).toBe('disconnected')
		const p = client.connect()
		expect(client.status).toBe('connecting')
		await p
		expect(client.status).toBe('connected')
		client.disconnect()
	})

	test('disconnect sets status to disconnected', async () => {
		const client = new GroveClient({ url: 'ws://localhost:3000/ws', autoReconnect: false, pingInterval: 999999 })
		await client.connect()
		client.disconnect()
		expect(client.status).toBe('disconnected')
	})

	test('subscribe sends subscribe message when connected', async () => {
		const client = new GroveClient({ url: 'ws://localhost:3000/ws', autoReconnect: false, pingInterval: 999999 })
		await client.connect()
		client.subscribe(['team:t1'])
		const subMsg = JSON.parse(mockWs.sent[mockWs.sent.length - 1])
		expect(subMsg.type).toBe('subscribe')
		expect(subMsg.channels).toEqual(['team:t1'])
		client.disconnect()
	})

	test('unsubscribe sends unsubscribe message', async () => {
		const client = new GroveClient({ url: 'ws://localhost:3000/ws', autoReconnect: false, pingInterval: 999999 })
		await client.connect()
		client.subscribe(['team:t1'])
		client.unsubscribe(['team:t1'])
		const unsubMsg = JSON.parse(mockWs.sent[mockWs.sent.length - 1])
		expect(unsubMsg.type).toBe('unsubscribe')
		client.disconnect()
	})

	test('handles activity events', async () => {
		const client = new GroveClient({ url: 'ws://localhost:3000/ws', autoReconnect: false, pingInterval: 999999 })
		await client.connect()
		const received: unknown[] = []
		client.on('activity', (data, channel) => received.push({ data, channel }))
		mockWs.simulateMessage({ type: 'activity', data: { id: 1 }, channel: 'team:t1' })
		expect(received).toHaveLength(1)
		client.disconnect()
	})

	test('handles rpc:response resolves pending call', async () => {
		const client = new GroveClient({ url: 'ws://localhost:3000/ws', autoReconnect: false, pingInterval: 999999, rpcTimeout: 5000 })
		await client.connect()
		const promise = client.version()
		// Find the RPC message that was sent
		const rpcMsg = JSON.parse(mockWs.sent[mockWs.sent.length - 1])
		expect(rpcMsg.type).toBe('rpc')
		expect(rpcMsg.method).toBe('version')
		// Simulate server response
		mockWs.simulateMessage({ type: 'rpc:response', id: rpcMsg.id, data: { version: '1.0' } })
		const result = await promise
		expect(result).toEqual({ version: '1.0' })
		client.disconnect()
	})

	test('handles rpc:response with error rejects', async () => {
		const client = new GroveClient({ url: 'ws://localhost:3000/ws', autoReconnect: false, pingInterval: 999999, rpcTimeout: 5000 })
		await client.connect()
		const promise = client.version()
		const rpcMsg = JSON.parse(mockWs.sent[mockWs.sent.length - 1])
		mockWs.simulateMessage({ type: 'rpc:response', id: rpcMsg.id, error: 'not found' })
		expect(promise).rejects.toThrow('not found')
		client.disconnect()
	})

	test('rpc rejects when not connected', () => {
		const client = new GroveClient({ url: 'ws://localhost:3000/ws', autoReconnect: false })
		expect(client.version()).rejects.toThrow('Not connected')
	})

	test('handles pong messages', async () => {
		const client = new GroveClient({ url: 'ws://localhost:3000/ws', autoReconnect: false, pingInterval: 999999 })
		await client.connect()
		mockWs.simulateMessage({ type: 'pong' })
		// No error thrown = success
		client.disconnect()
	})

	test('emits connected event', async () => {
		const client = new GroveClient({ url: 'ws://localhost:3000/ws', autoReconnect: false, pingInterval: 999999 })
		await client.connect()
		let fired = false
		client.on('connected', () => { fired = true })
		mockWs.simulateMessage({ type: 'connected' })
		expect(fired).toBe(true)
		client.disconnect()
	})
})
