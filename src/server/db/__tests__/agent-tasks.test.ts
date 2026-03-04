import { beforeEach, describe, expect, test } from 'bun:test'
import { dbInsertTasks, dbListTasks, dbUpdateTask } from '../agent-tasks'
import { dbInsertRepo } from '../repos'
import { dbInsertTeam } from '../teams'
import { makeTestDb, REPO, TEAM } from './helpers'

describe('db/agent-tasks', () => {
	beforeEach(() => {
		makeTestDb()
		dbInsertRepo(REPO)
		dbInsertTeam(TEAM)
	})

	test('list returns empty initially', () => {
		expect(dbListTasks('t1')).toEqual([])
	})

	test('bulk insert and list', () => {
		dbInsertTasks('t1', [
			{ idString: 'task-1', title: 'First', priority: 1 },
			{ idString: 'task-2', title: 'Second', priority: 2 },
		])
		const tasks = dbListTasks('t1')
		expect(tasks).toHaveLength(2)
		expect(tasks[0].status).toBe('pending')
	})

	test('update task status', () => {
		dbInsertTasks('t1', [{ idString: 'task-1', title: 'Task', priority: 1 }])
		dbUpdateTask('t1', 'task-1', { status: 'complete' })
		const tasks = dbListTasks('t1')
		expect(tasks[0].status).toBe('complete')
	})

	test('update task blockedBy serializes as JSON', () => {
		dbInsertTasks('t1', [{ idString: 'task-1', title: 'Task', priority: 1 }])
		dbUpdateTask('t1', 'task-1', { blockedBy: ['task-2', 'task-3'] })
		const tasks = dbListTasks('t1')
		expect(tasks[0].blockedBy).toBe('["task-2","task-3"]')
	})

	test('filters by team', () => {
		dbInsertRepo({
			id: 'r2',
			name: 'r2',
			path: '/r2',
			envVars: undefined,
			setupSteps: undefined,
		})
		dbInsertTeam({ ...TEAM, id: 't2', repoId: 'r2' })
		dbInsertTasks('t1', [{ idString: 'a', title: 'A', priority: 1 }])
		dbInsertTasks('t2', [{ idString: 'b', title: 'B', priority: 1 }])
		expect(dbListTasks('t1')).toHaveLength(1)
		expect(dbListTasks('t2')).toHaveLength(1)
	})
})
