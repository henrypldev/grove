import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { GroveRestClient } from '../rest'

const originalFetch = globalThis.fetch

describe('GroveRestClient', () => {
	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	test('converts wss URL to https', async () => {
		const client = new GroveRestClient('wss://example.com/ws')
		// Verify by attempting a request and checking the URL
		globalThis.fetch = mock((url: string) => {
			expect(url).toStartWith('https://example.com/')
			return Promise.resolve(new Response(JSON.stringify({})))
		}) as any
		await client.teams.create({ repoId: 'r1', task: 'test' })
	})

	test('converts ws URL to http', async () => {
		const client = new GroveRestClient('ws://localhost:3000/ws')
		globalThis.fetch = mock((url: string) => {
			expect(url).toStartWith('http://localhost:3000/')
			return Promise.resolve(new Response(JSON.stringify({})))
		}) as any
		await client.teams.create({ repoId: 'r1', task: 'test' })
	})

	test('teams.create sends POST with FormData', async () => {
		const client = new GroveRestClient('ws://localhost:3000/ws')
		globalThis.fetch = mock((url: string, init: RequestInit) => {
			expect(url).toBe('http://localhost:3000/v2/teams')
			expect(init.method).toBe('POST')
			expect(init.body).toBeInstanceOf(FormData)
			return Promise.resolve(
				new Response(JSON.stringify({ id: 't1', task: 'test' })),
			)
		}) as any
		const result = await client.teams.create({ repoId: 'r1', task: 'test' })
		expect((result as any).id).toBe('t1')
	})

	test('teams.create throws on error response', async () => {
		const client = new GroveRestClient('ws://localhost:3000/ws')
		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify({ error: 'bad request' }), { status: 400 }),
			),
		) as any
		expect(client.teams.create({ repoId: 'r1', task: 'test' })).rejects.toThrow('bad request')
	})

	test('teams.sendMessage sends to correct URL', async () => {
		const client = new GroveRestClient('ws://localhost:3000/ws')
		globalThis.fetch = mock((url: string) => {
			expect(url).toBe('http://localhost:3000/v2/teams/t1/messages')
			return Promise.resolve(
				new Response(JSON.stringify({ id: 1, type: 'user:message' })),
			)
		}) as any
		await client.teams.sendMessage({ id: 't1', text: 'hello' })
	})
})
