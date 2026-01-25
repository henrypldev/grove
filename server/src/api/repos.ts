import { basename, join } from 'node:path'
import { generateId, loadConfig, type Repo, saveConfig } from '../config'

export async function getRepos(): Promise<Repo[]> {
	const config = await loadConfig()
	return config.repos
}

export async function addRepo(path: string): Promise<Repo | null> {
	console.log('Checking path exists:', path)
	const pathFile = Bun.file(path)
	if (!(await pathFile.exists())) {
		console.log('Path does not exist')
		return null
	}

	const result = await Bun.$`test -d ${path}`.quiet().nothrow()
	if (result.exitCode !== 0) {
		console.log('Path is not a directory')
		return null
	}

	const gitDir = join(path, '.git')
	console.log('Checking for .git:', gitDir)
	const gitFile = Bun.file(gitDir)
	if (!(await gitFile.exists())) {
		console.log('.git not found')
		return null
	}

	const config = await loadConfig()

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
	await saveConfig(config)

	return repo
}

export async function deleteRepo(id: string): Promise<boolean> {
	const config = await loadConfig()
	const index = config.repos.findIndex(r => r.id === id)
	if (index === -1) {
		return false
	}
	config.repos.splice(index, 1)
	await saveConfig(config)
	return true
}
