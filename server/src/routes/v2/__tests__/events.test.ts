import { beforeEach, describe, expect, test } from 'bun:test'
import { makeTestDb } from '../../../db/__tests__/helpers'
import { dbInsertAgent } from '../../../db/agents'
import { dbInsertRepo } from '../../../db/repos'
import { dbInsertTeam } from '../../../db/teams'
import { handleV2Events } from '../events'

function makeReq(method: string, body?: unknown): Request {
	return new Request('http://localhost', {
		method,
		headers: body ? { 'Content-Type': 'application/json' } : {},
		body: body ? JSON.stringify(body) : undefined,
	})
}

const headers = {}

describe('handleV2Events', () => {
	beforeEach(() => {
		makeTestDb()
		dbInsertRepo({
			id: 'r1',
			name: 'repo',
			path: '/p',
			envVars: undefined,
			setupSteps: undefined,
		})
		dbInsertTeam({
			id: 't1',
			repoId: 'r1',
			worktreePath: '/wt',
			task: 'x',
			status: 'planning',
			pmSummary: null,
		metroPort: null,
			createdAt: 1000,
			updatedAt: 1000,
		})
		dbInsertAgent({
			id: 'a1',
			teamId: 't1',
			role: 'dev',
			status: 'working',
			activity: null,
			currentTask: null,
			sessionId: null,
			retryCount: 0,
			spawnedAt: 1000,
			updatedAt: 1000,
		})
	})

	test('POST /v2/events inserts and returns event', async () => {
		const res = await handleV2Events(
			makeReq('POST', {
				teamId: 't1',
				agentId: 'a1',
				type: 'test',
				payload: { x: 1 },
			}),
			new URL('http://localhost/v2/events'),
			headers,
		)
		expect(res?.status).toBe(200)
		const ev = await res?.json()
		expect(ev.teamId).toBe('t1')
		expect(ev.type).toBe('test')
		expect(typeof ev.id).toBe('number')
	})

	test('POST /v2/events missing fields returns 400', async () => {
		const res = await handleV2Events(
			makeReq('POST', { teamId: 't1' }),
			new URL('http://localhost/v2/events'),
			headers,
		)
		expect(res?.status).toBe(400)
	})

	test('POST /v2/events unknown team returns 404', async () => {
		const res = await handleV2Events(
			makeReq('POST', {
				teamId: 'nope',
				agentId: 'a1',
				type: 't',
				payload: {},
			}),
			new URL('http://localhost/v2/events'),
			headers,
		)
		expect(res?.status).toBe(404)
	})

	test('POST /v2/events unknown agent returns 404', async () => {
		const res = await handleV2Events(
			makeReq('POST', {
				teamId: 't1',
				agentId: 'nope',
				type: 't',
				payload: {},
			}),
			new URL('http://localhost/v2/events'),
			headers,
		)
		expect(res?.status).toBe(404)
	})

	test('unmatched path returns null', async () => {
		const res = await handleV2Events(
			makeReq('GET'),
			new URL('http://localhost/v2/other'),
			headers,
		)
		expect(res).toBeNull()
	})
})
