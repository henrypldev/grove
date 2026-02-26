import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { makeTestDb } from '../../../db/__tests__/helpers'
import { dbInsertAgent } from '../../../db/agents'
import { dbInsertRepo } from '../../../db/repos'
import { dbInsertTeam } from '../../../db/teams'

mock.module('@anthropic-ai/claude-agent-sdk', () => ({
	query: () => {
		const gen = (async function* () {})()
		return Object.assign(gen, { close: () => {} })
	},
	unstable_v2_prompt: async () => ({ type: 'result', subtype: 'success' }),
	createSdkMcpServer: (opts: any) => opts,
	tool: (...args: any[]) => args,
}))

mock.module('../../../api/worktrees', () => ({
	createWorktree: async (_repoId: string, _branch: string, _base: string) => ({
		path: '/tmp/fake-worktree',
	}),
}))

const { handleV2Teams, setTeamCreatedHook } = await import('../teams')

function makeReq(method: string, body?: unknown): Request {
	return new Request('http://localhost', {
		method,
		headers: body ? { 'Content-Type': 'application/json' } : {},
		body: body ? JSON.stringify(body) : undefined,
	})
}
function makeUrl(path: string, search = ''): URL {
	return new URL(`http://localhost${path}${search}`)
}

const headers = {}

const REPO = {
	id: 'r1',
	name: 'repo',
	path: '/p',
	envVars: undefined,
	setupSteps: undefined,
}

describe('handleV2Teams', () => {
	beforeEach(() => {
		makeTestDb()
		dbInsertRepo(REPO)
		setTeamCreatedHook(null as unknown as () => Promise<void>)
	})

	test('GET /v2/teams returns empty', async () => {
		const res = await handleV2Teams(
			makeReq('GET'),
			makeUrl('/v2/teams'),
			headers,
		)
		expect(await res?.json()).toEqual([])
	})

	test('POST /v2/teams creates team', async () => {
		const res = await handleV2Teams(
			makeReq('POST', { repoId: 'r1', task: 'build X' }),
			makeUrl('/v2/teams'),
			headers,
		)
		expect(res?.status).toBe(200)
		const team = await res?.json()
		expect(team.task).toBe('build X')
		expect(team.status).toBe('planning')
		expect(team.worktreePath).toBe('/tmp/fake-worktree')
	})

	test('POST /v2/teams missing repoId returns 400', async () => {
		const res = await handleV2Teams(
			makeReq('POST', { task: 'oops' }),
			makeUrl('/v2/teams'),
			headers,
		)
		expect(res?.status).toBe(400)
	})

	test('POST /v2/teams unknown repoId returns 404', async () => {
		const res = await handleV2Teams(
			makeReq('POST', { repoId: 'nope', task: 'x' }),
			makeUrl('/v2/teams'),
			headers,
		)
		expect(res?.status).toBe(404)
	})

	test('GET /v2/teams/:id returns team with agents', async () => {
		dbInsertTeam({
			id: 't1',
			repoId: 'r1',
			worktreePath: '/wt',
			task: 'x',
			status: 'planning',
			pmSummary: null,
			port: null,
			title: null,
			createdAt: 1000,
			updatedAt: 1000,
		})
		const res = await handleV2Teams(
			makeReq('GET'),
			makeUrl('/v2/teams/t1'),
			headers,
		)
		const body = await res?.json()
		expect(body.id).toBe('t1')
		expect(Array.isArray(body.agents)).toBe(true)
	})

	test('GET /v2/teams/:id non-existent returns 404', async () => {
		const res = await handleV2Teams(
			makeReq('GET'),
			makeUrl('/v2/teams/nope'),
			headers,
		)
		expect(res?.status).toBe(404)
	})

	test('DELETE /v2/teams/:id archives team', async () => {
		dbInsertTeam({
			id: 't1',
			repoId: 'r1',
			worktreePath: '/wt',
			task: 'x',
			status: 'planning',
			pmSummary: null,
			port: null,
			title: null,
			createdAt: 1000,
			updatedAt: 1000,
		})
		const res = await handleV2Teams(
			makeReq('DELETE'),
			makeUrl('/v2/teams/t1'),
			headers,
		)
		const body = await res?.json()
		expect(body.success).toBe(true)
	})

	test('GET /v2/teams/:id/agents lists agents', async () => {
		dbInsertTeam({
			id: 't1',
			repoId: 'r1',
			worktreePath: '/wt',
			task: 'x',
			status: 'planning',
			pmSummary: null,
			port: null,
			title: null,
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
		const res = await handleV2Teams(
			makeReq('GET'),
			makeUrl('/v2/teams/t1/agents'),
			headers,
		)
		expect(await res?.json()).toHaveLength(1)
	})

	test('GET /v2/teams/:id/events filters by since', async () => {
		const res = await handleV2Teams(
			makeReq('GET'),
			makeUrl('/v2/teams/t1/events', '?since=0'),
			headers,
		)
		expect(await res?.json()).toEqual([])
	})

	test('onTeamCreated hook fires on POST', async () => {
		let fired = false
		setTeamCreatedHook(async () => {
			fired = true
		})
		await handleV2Teams(
			makeReq('POST', { repoId: 'r1', task: 'x' }),
			makeUrl('/v2/teams'),
			headers,
		)
		expect(fired).toBe(true)
	})
})
