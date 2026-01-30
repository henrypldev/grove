import { join } from 'node:path'
import { getCloneDirectory, loadConfig, log } from '../config'
import { addRepo } from './repos'

export interface GitHubRepo {
	name: string
	fullName: string
	description: string
	private: boolean
	url: string
}

export async function getGitHubRepos(): Promise<GitHubRepo[]> {
	log('github', 'fetching user repos')
	const result =
		await Bun.$`gh repo list --json name,nameWithOwner,description,isPrivate,url --limit 100`
			.quiet()
			.nothrow()
	if (result.exitCode !== 0) {
		log('github', 'failed to fetch repos', { exitCode: result.exitCode })
		return []
	}
	const raw = JSON.parse(result.text())
	const repos: GitHubRepo[] = raw.map(
		(r: {
			name: string
			nameWithOwner: string
			description: string
			isPrivate: boolean
			url: string
		}) => ({
			name: r.name,
			fullName: r.nameWithOwner,
			description: r.description,
			private: r.isPrivate,
			url: r.url,
		}),
	)
	log('github', 'fetched repos', { count: repos.length })
	return repos
}

export async function getGitHubOrgs(): Promise<{ name: string }[]> {
	log('github', 'fetching orgs')
	const result = await Bun.$`gh org list`.quiet().nothrow()
	if (result.exitCode !== 0) {
		log('github', 'failed to fetch orgs', { exitCode: result.exitCode })
		return []
	}
	const orgs = result
		.text()
		.trim()
		.split('\n')
		.filter(Boolean)
		.map(name => ({ name }))
	log('github', 'fetched orgs', { count: orgs.length })
	return orgs
}

export async function getOrgRepos(org: string): Promise<GitHubRepo[]> {
	log('github', 'fetching org repos', { org })
	const result =
		await Bun.$`gh repo list ${org} --json name,nameWithOwner,description,isPrivate,url --limit 100`
			.quiet()
			.nothrow()
	if (result.exitCode !== 0) {
		log('github', 'failed to fetch org repos', {
			org,
			exitCode: result.exitCode,
		})
		return []
	}
	const raw = JSON.parse(result.text())
	const repos: GitHubRepo[] = raw.map(
		(r: {
			name: string
			nameWithOwner: string
			description: string
			isPrivate: boolean
			url: string
		}) => ({
			name: r.name,
			fullName: r.nameWithOwner,
			description: r.description,
			private: r.isPrivate,
			url: r.url,
		}),
	)
	log('github', 'fetched org repos', { org, count: repos.length })
	return repos
}

export async function cloneRepo(
	fullName: string,
): Promise<import('../config').Repo | null> {
	log('github', 'cloning repo', { fullName })
	const cloneDir = await getCloneDirectory()
	const repoName = fullName.split('/').pop() ?? fullName
	const targetPath = join(cloneDir, repoName)

	const config = await loadConfig()
	const existing = config.repos.find(r => r.path === targetPath)
	if (existing) {
		log('github', 'repo already registered', {
			id: existing.id,
			path: targetPath,
		})
		return existing
	}

	const dirResult = await Bun.$`test -d ${targetPath}`.quiet().nothrow()
	if (dirResult.exitCode === 0) {
		const gitResult = await Bun.$`test -e ${join(targetPath, '.git')}`
			.quiet()
			.nothrow()
		if (gitResult.exitCode === 0) {
			log('github', 'directory exists with git repo, registering', {
				targetPath,
			})
			return addRepo(targetPath)
		}
	}

	const cloneResult = await Bun.$`gh repo clone ${fullName} ${targetPath}`
		.quiet()
		.nothrow()
	if (cloneResult.exitCode !== 0) {
		log('github', 'clone failed', { fullName, exitCode: cloneResult.exitCode })
		return null
	}

	log('github', 'clone successful', { fullName, targetPath })
	return addRepo(targetPath)
}
