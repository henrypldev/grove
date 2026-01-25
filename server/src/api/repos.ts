import { existsSync, statSync } from 'fs'
import { basename, join } from 'path'
import { generateId, loadConfig, type Repo, saveConfig } from '../config'

export function getRepos(): Repo[] {
	const config = loadConfig()
	return config.repos
}

export function addRepo(path: string): Repo | null {
	console.log('Checking path exists:', path)
	if (!existsSync(path)) {
		console.log('Path does not exist')
		return null
	}

	const stat = statSync(path)
	if (!stat.isDirectory()) {
		console.log('Path is not a directory')
		return null
	}

	const gitDir = join(path, '.git')
	console.log('Checking for .git:', gitDir)
	if (!existsSync(gitDir)) {
		console.log('.git not found')
		return null
	}

	const config = loadConfig()

	const existing = config.repos.find(r => r.path === path)
	if (existing) {
		return existing
	}

	const repo: Repo = {
		id: generateId(),
		path,
		name: basename(path),
	}

	config.repos.push(repo)
	saveConfig(config)

	return repo
}

export function deleteRepo(id: string): boolean {
	const config = loadConfig()
	const index = config.repos.findIndex(r => r.id === id)
	if (index === -1) {
		return false
	}
	config.repos.splice(index, 1)
	saveConfig(config)
	return true
}
