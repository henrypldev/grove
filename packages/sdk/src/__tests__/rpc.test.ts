import { describe, expect, test } from 'bun:test'
import { buildRpcNamespaces } from '../rpc'

describe('buildRpcNamespaces', () => {
	test('all top-level namespaces exist', () => {
		const calls: Array<{ method: string; params: unknown }> = []
		const ns = buildRpcNamespaces((method, params) => {
			calls.push({ method, params })
			return Promise.resolve(undefined as any)
		})

		expect(typeof ns.version).toBe('function')
		expect(typeof ns.config).toBe('object')
		expect(typeof ns.github).toBe('object')
		expect(typeof ns.repos).toBe('object')
		expect(typeof ns.scripts).toBe('object')
		expect(typeof ns.teams).toBe('object')
		expect(typeof ns.dashboard).toBe('function')
		expect(typeof ns.conflicts).toBe('function')
		expect(typeof ns.usage).toBe('function')
		expect(typeof ns.activity).toBe('object')
	})

	test('version calls correct RPC method', async () => {
		const calls: Array<{ method: string; params: unknown }> = []
		const ns = buildRpcNamespaces((method, params) => {
			calls.push({ method, params })
			return Promise.resolve({ version: '1.0.0' } as any)
		})
		await ns.version()
		expect(calls[0].method).toBe('version')
	})

	test('nested namespace calls correct method', async () => {
		const calls: Array<{ method: string; params: unknown }> = []
		const ns = buildRpcNamespaces((method, params) => {
			calls.push({ method, params })
			return Promise.resolve(undefined as any)
		})
		await ns.repos.list()
		expect(calls[0].method).toBe('repos:list')
	})

	test('params are passed through', async () => {
		const calls: Array<{ method: string; params: unknown }> = []
		const ns = buildRpcNamespaces((method, params) => {
			calls.push({ method, params })
			return Promise.resolve(undefined as any)
		})
		await ns.repos.add({ path: '/tmp/repo' })
		expect(calls[0].params).toEqual({ path: '/tmp/repo' })
	})

	test('deeply nested namespace works', async () => {
		const calls: Array<{ method: string; params: unknown }> = []
		const ns = buildRpcNamespaces((method, params) => {
			calls.push({ method, params })
			return Promise.resolve(undefined as any)
		})
		await ns.teams.setup.retry({ id: 't1' })
		expect(calls[0].method).toBe('teams:setup:retry')
		expect(calls[0].params).toEqual({ id: 't1' })
	})
})
