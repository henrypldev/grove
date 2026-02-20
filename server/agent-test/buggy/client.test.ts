import { describe, expect, test } from 'bun:test'

const responses: Array<Response> = []

globalThis.fetch = async (_url: string | URL | Request, _init?: RequestInit) => {
	const next = responses.shift()
	if (next) return next
	return new Response(JSON.stringify({ id: '1', name: 'Test', email: 't@t.com' }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	})
}

let lastInit: RequestInit | undefined

const origFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
	lastInit = init
	return origFetch(url, init)
}

const { fetchUser, createUser, retryFetch } = await import('./client')

describe('client', () => {
	test('fetchUser throws on non-ok response', async () => {
		responses.push(new Response('Not Found', { status: 404 }))
		await expect(fetchUser('bad-id')).rejects.toThrow()
	})

	test('createUser sends Content-Type application/json', async () => {
		await createUser('Alice', 'alice@example.com')
		const headers = lastInit?.headers as Record<string, string>
		expect(headers?.['Content-Type']).toBe('application/json')
	})

	test('retryFetch returns response after retry', async () => {
		let calls = 0
		globalThis.fetch = async () => {
			calls++
			if (calls < 2) throw new Error('network error')
			return new Response('ok')
		}
		const res = await retryFetch('http://example.com', 2)
		expect(res).toBeDefined()
		expect(calls).toBe(2)
	})
})
