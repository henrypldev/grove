import { describe, expect, test } from 'bun:test'
import { averageCompletionTime, getActiveTaskCount, tasksDueForReview } from './stats'
import type { Task } from './stats'

const now = Date.now()

const tasks: Task[] = [
	{ id: '1', status: 'todo', priority: 2, createdAt: now - 5000, completedAt: null },
	{ id: '2', status: 'in_progress', priority: 3, createdAt: now - 4000, completedAt: null },
	{ id: '3', status: 'done', priority: 1, createdAt: now - 3000, completedAt: now - 1000 },
]

describe('stats', () => {
	test('getActiveTaskCount returns only in_progress tasks', () => {
		expect(getActiveTaskCount(tasks)).toBe(1)
	})

	test('averageCompletionTime divides by completed count not total', () => {
		expect(averageCompletionTime(tasks)).toBe(2000)
	})

	test('tasksDueForReview returns in_progress tasks older than window', () => {
		const result = tasksDueForReview(tasks, 3000)
		expect(result).toHaveLength(1)
		expect(result[0].id).toBe('2')
	})
})
