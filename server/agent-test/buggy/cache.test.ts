import { describe, expect, test } from 'bun:test'
import { get, getOrSet, isExpired, set } from './cache'

describe('cache', () => {
	test('get returns undefined for missing key', () => {
		expect(get('__missing__')).toBeUndefined()
	})

	test('get returns value after set', () => {
		set('cache:str', 'hello')
		expect(get('cache:str')).toBe('hello')
	})

	test('getOrSet works with falsy value 0', () => {
		expect(getOrSet('cache:zero', () => 0)).toBe(0)
		expect(getOrSet('cache:zero', () => 99)).toBe(0)
	})

	test('isExpired returns false for missing key', () => {
		expect(isExpired('__missing2__')).toBe(false)
	})

	test('isExpired returns false for non-expiring entry', () => {
		set('cache:perm', 'v')
		expect(isExpired('cache:perm')).toBe(false)
	})

	test('isExpired returns true after ttl', async () => {
		set('cache:short', 'v', 1)
		await new Promise(r => setTimeout(r, 10))
		expect(isExpired('cache:short')).toBe(true)
	})
})
