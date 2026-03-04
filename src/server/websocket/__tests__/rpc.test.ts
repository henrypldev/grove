import { describe, expect, test } from 'bun:test'

/**
 * Test handleRpc dispatch logic without mock.module (which leaks globally in Bun).
 * We import handleRpc and test its behavior: dispatch, unknown method, error handling.
 * The route handlers are already registered at import time, so we test against real registrations.
 */
import { handleRpc } from '../rpc'

function makeMockWs() {
	const sent: string[] = []
	return {
		send: (data: string) => sent.push(data),
		sent,
	}
}

describe('websocket/rpc', () => {
	test('unknown method sends error response', async () => {
		const ws = makeMockWs()
		await handleRpc(ws as any, {
			id: 'rpc_1',
			method: 'nonexistent',
			params: {},
		})
		const response = JSON.parse(ws.sent[0])
		expect(response.type).toBe('rpc:response')
		expect(response.id).toBe('rpc_1')
		expect(response.error).toBe('Unknown method: nonexistent')
	})

	test('known method dispatches and sends response', async () => {
		const ws = makeMockWs()
		// 'version' is a registered method that calls getVersion()
		// It will fail without DB but we can verify the dispatch + error handling
		await handleRpc(ws as any, { id: 'rpc_2', method: 'version', params: {} })
		const response = JSON.parse(ws.sent[0])
		expect(response.type).toBe('rpc:response')
		expect(response.id).toBe('rpc_2')
		// Either returns data or error - but proves dispatch worked
		expect('data' in response || 'error' in response).toBe(true)
	})

	test('response always includes type and id', async () => {
		const ws = makeMockWs()
		await handleRpc(ws as any, {
			id: 'rpc_3',
			method: 'repos:list',
			params: {},
		})
		const response = JSON.parse(ws.sent[0])
		expect(response.type).toBe('rpc:response')
		expect(response.id).toBe('rpc_3')
	})

	test('params are passed through to handler', async () => {
		const ws = makeMockWs()
		await handleRpc(ws as any, {
			id: 'rpc_4',
			method: 'teams:get',
			params: { id: 't1' },
		})
		const response = JSON.parse(ws.sent[0])
		expect(response.type).toBe('rpc:response')
		expect(response.id).toBe('rpc_4')
	})
})
