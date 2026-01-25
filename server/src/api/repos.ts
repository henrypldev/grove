import { basename, join } from 'node:path'
import { generateId, loadConfig, log, type Repo, saveConfig } from '../config'

export async function getRepos(): Promise<Repo[]> {
	log('repos', 'getting repos')
	const config = await loadConfig()
	log('repos', 'found repos', { count: config.repos.length })
	return config.repos
}

export async function addRepo(path: string): Promise<Repo | null> {
	log('repos', 'adding repo', { path })
	const pathFile = Bun.file(path)
	if (!(await pathFile.exists())) {
		log('repos', 'path does not exist', { path })
		return null
	}

	const result = await Bun.$`test -d ${path}`.quiet().nothrow()
	if (result.exitCode !== 0) {
		log('repos', 'path is not a directory', { path })
		return null
	}

	const gitDir = join(path, '.git')
	const gitFile = Bun.file(gitDir)
	if (!(await gitFile.exists())) {
		log('repos', '.git not found', { gitDir })
		return null
	}

	const config = await loadConfig()

	const existing = config.repos.find(r => r.path === path)
	if (existing) {
		log('repos', 'repo already exists', { id: existing.id })
		return existing
	}

	const repo: Repo = {
		id: generateId(),
		path,
		name: basename(path),
	}

	config.repos.push(repo)
	await saveConfig(config)

	log('repos', 'repo added', { id: repo.id, name: repo.name })
	return repo
}

export async function deleteRepo(id: string): Promise<boolean> {
	log('repos', 'deleting repo', { id })
	const config = await loadConfig()
	const index = config.repos.findIndex(r => r.id === id)
	if (index === -1) {
		log('repos', 'repo not found', { id })
		return false
	}
	config.repos.splice(index, 1)
	await saveConfig(config)
	log('repos', 'repo deleted', { id })
	return true
}
