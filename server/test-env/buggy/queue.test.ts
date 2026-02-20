import { describe, expect, test } from 'bun:test'
import { JobQueue } from './queue'

describe('JobQueue', () => {
	test('jobs execute in order', async () => {
		const q = new JobQueue()
		const order: number[] = []
		q.enqueue(async () => {
			await new Promise(r => setTimeout(r, 20))
			order.push(1)
		})
		q.enqueue(async () => {
			order.push(2)
		})
		await new Promise(r => setTimeout(r, 80))
		expect(order).toEqual([1, 2])
	})

	test('processed count is accurate after all jobs complete', async () => {
		const q = new JobQueue()
		q.enqueue(async () => {})
		q.enqueue(async () => {})
		await new Promise(r => setTimeout(r, 40))
		expect(q.stats().processed).toBe(2)
	})

	test('failed count increments on thrown error', async () => {
		const q = new JobQueue()
		q.enqueue(async () => {
			throw new Error('oops')
		})
		await new Promise(r => setTimeout(r, 20))
		expect(q.stats().failed).toBe(1)
	})
})
