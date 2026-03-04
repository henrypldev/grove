import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { readFramework } from '../agents/setup-detector'
import { generateId, log } from '../config'
import { dbGetRepoByPath } from '../db/repos'
import type { Repo } from '../types'
import { detectEnvVars } from './worktrees'

export function withSetupFile<T extends Repo>(
	repo: T,
): T & { hasSetupFile: boolean } {
	return {
		...repo,
		hasSetupFile: existsSync(join(repo.path, '.grove', 'setup.json')),
	}
}

export async function addRepo(path: string): Promise<Repo | string> {
	log('repos', 'adding repo', { path })

	const existing = dbGetRepoByPath(path)
	if (existing) {
		log('repos', 'repo already exists', { id: existing.id })
		return existing
	}

	const result = await Bun.$`test -d ${path}`.quiet().nothrow()
	if (result.exitCode !== 0) {
		log('repos', 'path does not exist or is not a directory', { path })
		return `Path does not exist or is not a directory: ${path}`
	}

	const gitResult = await Bun.$`git -C ${path} rev-parse --git-dir`
		.quiet()
		.nothrow()
	if (gitResult.exitCode !== 0) {
		log('repos', 'not a git repository', { path })
		return `Path is not a git repository: ${path}`
	}

	const [envVars, framework] = await Promise.all([
		detectEnvVars(path),
		readFramework(path),
	])
	const repo: Repo = {
		id: generateId(),
		path,
		name: basename(path),
		framework: framework ?? undefined,
		envVars: envVars.length > 0 ? envVars : undefined,
	}

	log('repos', 'repo added', { id: repo.id, name: repo.name })
	return repo
}
