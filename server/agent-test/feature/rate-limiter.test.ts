import { describe, expect, test } from 'bun:test'
import { RateLimiter } from './rate-limiter'

describe('RateLimiter', () => {
	test('allows requests within limit', () => {
		const rl = new RateLimiter(3, 1000)
		expect(rl.isAllowed('u1')).toBe(true)
		expect(rl.isAllowed('u1')).toBe(true)
		expect(rl.isAllowed('u1')).toBe(true)
	})

	test('blocks requests over limit', () => {
		const rl = new RateLimiter(2, 1000)
		rl.isAllowed('u2')
		rl.isAllowed('u2')
		expect(rl.isAllowed('u2')).toBe(false)
	})

	test('allows again after window expires', async () => {
		const rl = new RateLimiter(1, 50)
		rl.isAllowed('u3')
		expect(rl.isAllowed('u3')).toBe(false)
		await new Promise(r => setTimeout(r, 60))
		expect(rl.isAllowed('u3')).toBe(true)
	})

	test('retryAfter returns ms until next slot is available', () => {
		const rl = new RateLimiter(1, 1000)
		rl.isAllowed('u4')
		const ms = rl.retryAfter('u4')
		expect(ms).toBeGreaterThan(0)
		expect(ms).toBeLessThanOrEqual(1000)
	})

	test('different keys are tracked independently', () => {
		const rl = new RateLimiter(1, 1000)
		rl.isAllowed('u5')
		expect(rl.isAllowed('u5')).toBe(false)
		expect(rl.isAllowed('u6')).toBe(true)
	})

	test('cleanup removes expired entries', async () => {
		const rl = new RateLimiter(1, 30)
		rl.isAllowed('u7')
		await new Promise(r => setTimeout(r, 40))
		rl.cleanup()
		expect(rl.isAllowed('u7')).toBe(true)
	})
})
