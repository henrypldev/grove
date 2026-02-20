import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { makeTestDb } from '../../../db/__tests__/helpers'
import { dbInsertRepo } from '../../../db/repos'
import { dbInsertTeam } from '../../../db/teams'

mock.module('../../../api/repos', () => ({
	addRepo: async (path: string) => ({ id: 'new-id', name: 'new-repo', path, envVars: undefined, setupSteps: undefined }),
	withSetupFile: (repo: unknown) => repo,
}))

const { handleV2Repos } = await import('../repos')

function makeReq(method: string, body?: unknown): Request {
	return new Request('http://localhost', {
		method,
		headers: body ? { 'Content-Type': 'application/json' } : {},
		body: body ? JSON.stringify(body) : undefined,
	})
}

function makeUrl(path: string): URL {
	return new URL(`http://localhost${path}`)
}

const headers = {}

describe('handleV2Repos', () => {
	beforeEach(() => makeTestDb())

	test('GET /v2/repos returns empty array', async () => {
		const res = await handleV2Repos(makeReq('GET'), makeUrl('/v2/repos'), headers)
		expect(res?.status).toBe(200)
		expect(await res?.json()).toEqual([])
	})

	test('POST /v2/repos creates repo', async () => {
		const res = await handleV2Repos(
			makeReq('POST', { path: '/tmp/new' }),
			makeUrl('/v2/repos'),
			headers,
		)
		expect(res?.status).toBe(200)
		const body = await res?.json()
		expect(body.path).toBe('/tmp/new')
	})

	test('GET /v2/repos after POST lists it', async () => {
		await handleV2Repos(makeReq('POST', { path: '/tmp/new' }), makeUrl('/v2/repos'), headers)
		const res = await handleV2Repos(makeReq('GET'), makeUrl('/v2/repos'), headers)
		const list = await res?.json()
		expect(list).toHaveLength(1)
	})

	test('DELETE /v2/repos/:id removes repo', async () => {
		dbInsertRepo({ id: 'r1', name: 'r', path: '/p', envVars: undefined, setupSteps: undefined })
		const res = await handleV2Repos(makeReq('DELETE'), makeUrl('/v2/repos/r1'), headers)
		expect(res?.status).toBe(200)
		expect((await res?.json()).success).toBe(true)
	})

	test('DELETE /v2/repos/:id non-existent returns 404', async () => {
		const res = await handleV2Repos(makeReq('DELETE'), makeUrl('/v2/repos/nope'), headers)
		expect(res?.status).toBe(404)
	})

	test('GET /v2/repos/:id/teams returns teams', async () => {
		dbInsertRepo({ id: 'r1', name: 'r', path: '/p', envVars: undefined, setupSteps: undefined })
		dbInsertTeam({ id: 't1', repoId: 'r1', worktreePath: '/wt', task: 'task', status: 'planning', pmSummary: null, createdAt: 1000, updatedAt: 1000 })
		const res = await handleV2Repos(makeReq('GET'), makeUrl('/v2/repos/r1/teams'), headers)
		const list = await res?.json()
		expect(list).toHaveLength(1)
	})

	test('GET /v2/repos/:id/teams non-existent repo returns 404', async () => {
		const res = await handleV2Repos(makeReq('GET'), makeUrl('/v2/repos/nope/teams'), headers)
		expect(res?.status).toBe(404)
	})

	test('unmatched path returns null', async () => {
		const res = await handleV2Repos(makeReq('GET'), makeUrl('/v2/other'), headers)
		expect(res).toBeNull()
	})
})
