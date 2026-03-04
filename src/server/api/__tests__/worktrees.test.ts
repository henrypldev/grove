import { describe, expect, mock, test } from 'bun:test'

// Mock config module with empty repos (testing error paths)
mock.module('../../config', () => ({
	loadConfig: mock(() => Promise.resolve({ repos: [] })),
	WORKTREES_DIR: '/tmp/worktrees',
	log: mock(() => {}),
}))

import { createWorktree, deleteWorktree, getWorktrees } from '../worktrees'

describe('worktrees', () => {
	test('getWorktrees returns empty for missing repo', async () => {
		const result = await getWorktrees('nonexistent')
		expect(result).toEqual([])
	})

	test('createWorktree returns error for missing repo', async () => {
		const result = await createWorktree('nonexistent', 'feature', 'main')
		expect(result).toBe('Repo not found: nonexistent')
	})

	test('deleteWorktree returns error for missing repo', async () => {
		const result = await deleteWorktree('nonexistent', 'feature')
		expect(result).toBe('Repo not found: nonexistent')
	})
})
