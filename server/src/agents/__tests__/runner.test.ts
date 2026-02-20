import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { makeTestDb } from '../../db/__tests__/helpers'
import { dbGetAgent, dbInsertAgent } from '../../db/agents'
import { dbInsertRepo } from '../../db/repos'
import { dbInsertTeam } from '../../db/teams'

mock.module('@anthropic-ai/claude-agent-sdk', () => ({
	query: async function* () {},
}))

const { spawnAgent, respawnAgent } = await import('../runner')

const REPO = {
	id: 'r1',
	name: 'repo',
	path: '/p',
	envVars: undefined,
	setupSteps: undefined,
}
const TEAM = {
	id: 't1',
	repoId: 'r1',
	worktreePath: '/wt',
	task: 'x',
	status: 'planning' as const,
	pmSummary: null,
	createdAt: 1000,
	updatedAt: 1000,
}

describe('agent/runner', () => {
	beforeEach(() => {
		makeTestDb()
		dbInsertRepo(REPO)
		dbInsertTeam(TEAM)
	})

	test('spawnAgent inserts agent record with planning status', async () => {
		const agent = await spawnAgent({
			teamId: 't1',
			role: 'dev',
			prompt: 'do stuff',
			cwd: '/wt',
		})
		expect(agent.teamId).toBe('t1')
		expect(agent.role).toBe('dev')
		expect(agent.id).toBeTruthy()
		const fromDb = dbGetAgent(agent.id)
		expect(fromDb).not.toBeNull()
	})

	test('respawnAgent returns false for unknown agent', async () => {
		const result = await respawnAgent('nope', 'prompt', '/wt')
		expect(result).toBe(false)
	})

	test('respawnAgent returns false after max retries', async () => {
		dbInsertAgent({
			id: 'a1',
			teamId: 't1',
			role: 'dev',
			status: 'error',
			currentTask: null,
			sessionId: null,
			retryCount: 3,
			spawnedAt: 1000,
			updatedAt: 1000,
		})
		const result = await respawnAgent('a1', 'retry', '/wt')
		expect(result).toBe(false)
	})

	test('respawnAgent returns true and increments retry for valid agent', async () => {
		dbInsertAgent({
			id: 'a2',
			teamId: 't1',
			role: 'dev',
			status: 'error',
			currentTask: null,
			sessionId: null,
			retryCount: 0,
			spawnedAt: 1000,
			updatedAt: 1000,
		})
		const result = await respawnAgent('a2', 'retry', '/wt')
		expect(result).toBe(true)
		expect(dbGetAgent('a2')?.retryCount).toBe(1)
	})
})
