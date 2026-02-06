import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { generateId, loadConfig, log, type Repo, saveConfig } from '../config'
import { detectEnvVars } from './worktrees'

export function withSetupFile<T extends Repo>(
	repo: T,
): T & { hasSetupFile: boolean } {
	return {
		...repo,
		hasSetupFile: existsSync(join(repo.path, '.grove', 'setup.json')),
	}
}

export async function getRepos(): Promise<
	(Repo & { hasSetupFile: boolean })[]
> {
	log('repos', 'getting repos')
	const config = await loadConfig()
	log('repos', 'found repos', { count: config.repos.length })
	return config.repos.map(withSetupFile)
}

export async function addRepo(path: string): Promise<Repo | string> {
	log('repos', 'adding repo', { path })
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

	const config = await loadConfig()

	const existing = config.repos.find(r => r.path === path)
	if (existing) {
		log('repos', 'repo already exists', { id: existing.id })
		return existing
	}

	const envVars = await detectEnvVars(path)
	const repo: Repo = {
		id: generateId(),
		path,
		name: basename(path),
		envVars: envVars.length > 0 ? envVars : undefined,
	}

	config.repos.push(repo)
	await saveConfig(config)

	log('repos', 'repo added', { id: repo.id, name: repo.name })
	return repo
}

export async function deleteRepo(id: string): Promise<true | string> {
	log('repos', 'deleting repo', { id })
	const config = await loadConfig()
	const index = config.repos.findIndex(r => r.id === id)
	if (index === -1) {
		log('repos', 'repo not found', { id })
		return `Repo not found: ${id}`
	}
	config.repos.splice(index, 1)
	await saveConfig(config)
	log('repos', 'repo deleted', { id })
	return true
}
