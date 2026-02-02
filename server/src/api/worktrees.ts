import { join } from 'node:path'
import { loadConfig, log, WORKTREES_DIR, type EnvVar } from '../config'

export interface Worktree {
	path: string
	branch: string
	isMain: boolean
}

export async function getWorktrees(repoId: string): Promise<Worktree[]> {
	log('worktrees', 'getting worktrees', { repoId })
	const config = await loadConfig()
	const repo = config.repos.find(r => r.id === repoId)
	if (!repo) {
		log('worktrees', 'repo not found', { repoId })
		return []
	}

	await Bun.$`git -C ${repo.path} worktree prune`.quiet().nothrow()

	const result = await Bun.$`git -C ${repo.path} worktree list --porcelain`
		.quiet()
		.nothrow()
	const output = result.stdout.toString()
	const lines = output.trim().split('\n')

	const worktrees: Worktree[] = []
	let currentPath = ''
	let currentBranch = ''

	for (const line of lines) {
		if (line.startsWith('worktree ')) {
			currentPath = line.slice(9)
		} else if (line.startsWith('branch refs/heads/')) {
			currentBranch = line.slice(18)
		} else if (line === '') {
			if (currentPath && currentBranch) {
				worktrees.push({
					path: currentPath,
					branch: currentBranch,
					isMain: currentPath === repo.path,
				})
			}
			currentPath = ''
			currentBranch = ''
		}
	}

	if (currentPath && currentBranch) {
		worktrees.push({
			path: currentPath,
			branch: currentBranch,
			isMain: currentPath === repo.path,
		})
	}

	log('worktrees', 'found worktrees', { count: worktrees.length })
	return worktrees
}

function sanitizeBranchName(branch: string): string {
	return branch.replace(/\//g, '-')
}

export async function createWorktree(
	repoId: string,
	branch: string,
	baseBranch: string,
	copyEnv = true,
): Promise<Worktree | string> {
	log('worktrees', 'creating worktree', { repoId, branch, baseBranch })
	const config = await loadConfig()
	const repo = config.repos.find(r => r.id === repoId)
	if (!repo) {
		log('worktrees', 'repo not found', { repoId })
		return `Repo not found: ${repoId}`
	}

	const sanitizedBranch = sanitizeBranchName(branch)
	const worktreePath = join(WORKTREES_DIR, repo.name, sanitizedBranch)

	log('worktrees', 'creating directory', { worktreePath })
	await Bun.$`mkdir -p ${WORKTREES_DIR}/${repo.name}`.quiet()

	await Bun.$`git -C ${repo.path} fetch origin`.quiet().nothrow()

	let result =
		await Bun.$`git -C ${repo.path} worktree add -b ${branch} ${worktreePath} origin/${baseBranch}`
			.quiet()
			.nothrow()

	if (result.exitCode !== 0) {
		log('worktrees', 'new branch failed, trying existing branch', {
			branch,
		})
		result =
			await Bun.$`git -C ${repo.path} worktree add ${worktreePath} ${branch}`
				.quiet()
				.nothrow()
	}

	if (result.exitCode !== 0) {
		const stderr = result.stderr.toString().trim()
		log('worktrees', 'failed to create worktree', {
			exitCode: result.exitCode,
			stderr,
		})
		return `Failed to create worktree: ${stderr}`
	}

	if (copyEnv) {
		await copyUntrackedEnvFiles(repo.path, worktreePath)
	}

	log('worktrees', 'worktree created', { worktreePath, branch })
	return {
		path: worktreePath,
		branch,
		isMain: false,
	}
}

async function copyUntrackedEnvFiles(
	repoPath: string,
	worktreePath: string,
): Promise<void> {
	const glob = new Bun.Glob('.env*')
	const allFiles: string[] = []
	for await (const file of glob.scan({ cwd: repoPath, dot: true })) {
		if (!file.includes('/')) allFiles.push(file)
	}

	const trackedResult =
		await Bun.$`git -C ${repoPath} ls-files ${allFiles}`.quiet().nothrow()
	const trackedFiles = new Set(
		trackedResult.stdout.toString().trim().split('\n').filter(Boolean),
	)
	const files = allFiles.filter(f => !trackedFiles.has(f))

	for (const file of files) {
		const src = join(repoPath, file)
		const dest = join(worktreePath, file)
		try {
			await Bun.write(dest, Bun.file(src))
			log('worktrees', 'copied env file', { file })
		} catch {
			log('worktrees', 'failed to copy env file', { file })
		}
	}
}

export async function detectEnvVars(repoPath: string): Promise<EnvVar[]> {
	const glob = new Bun.Glob('.env*')
	const allFiles: string[] = []
	for await (const file of glob.scan({ cwd: repoPath, dot: true })) {
		allFiles.push(file)
	}

	if (allFiles.length === 0) return []

	const trackedResult =
		await Bun.$`git -C ${repoPath} ls-files ${allFiles}`.quiet().nothrow()
	const trackedFiles = new Set(
		trackedResult.stdout.toString().trim().split('\n').filter(Boolean),
	)
	const untrackedFiles = allFiles.filter(f => !trackedFiles.has(f))

	const envVars: EnvVar[] = []
	for (const file of untrackedFiles) {
		const content = await Bun.file(join(repoPath, file)).text()
		for (const line of content.split('\n')) {
			const trimmed = line.trim()
			if (!trimmed || trimmed.startsWith('#')) continue
			const eqIndex = trimmed.indexOf('=')
			if (eqIndex === -1) continue
			const key = trimmed.slice(0, eqIndex).trim()
			const value = trimmed.slice(eqIndex + 1).trim()
			if (key) {
				envVars.push({ key, value, filePath: file })
			}
		}
	}

	log('worktrees', 'detected env vars', {
		fileCount: untrackedFiles.length,
		varCount: envVars.length,
	})
	return envVars
}

export async function deleteWorktree(
	repoId: string,
	branch: string,
	force?: boolean,
): Promise<true | string> {
	log('worktrees', 'deleting worktree', { repoId, branch, force })
	const config = await loadConfig()
	const repo = config.repos.find(r => r.id === repoId)
	if (!repo) {
		log('worktrees', 'repo not found', { repoId })
		return `Repo not found: ${repoId}`
	}

	const worktrees = await getWorktrees(repoId)
	const worktree = worktrees.find(w => w.branch === branch)
	if (!worktree) {
		log('worktrees', 'worktree not found', { branch })
		return `Worktree not found: ${branch}`
	}

	if (worktree.isMain) {
		log('worktrees', 'cannot delete main worktree', { branch })
		return 'Cannot delete main worktree'
	}

	const result = force
		? await Bun.$`git -C ${repo.path} worktree remove --force ${worktree.path}`
				.quiet()
				.nothrow()
		: await Bun.$`git -C ${repo.path} worktree remove ${worktree.path}`
				.quiet()
				.nothrow()

	if (result.exitCode !== 0) {
		const stderr = result.stderr.toString().trim()
		log('worktrees', 'failed to delete worktree', {
			exitCode: result.exitCode,
			stderr,
		})
		return `Failed to remove worktree: ${stderr}`
	}

	const branchDelete = force
		? await Bun.$`git -C ${repo.path} branch -D ${branch}`.quiet().nothrow()
		: await Bun.$`git -C ${repo.path} branch -d ${branch}`.quiet().nothrow()

	if (branchDelete.exitCode !== 0) {
		log('worktrees', 'failed to delete branch', {
			branch,
			stderr: branchDelete.stderr.toString(),
		})
	} else {
		log('worktrees', 'branch deleted', { branch })
	}

	log('worktrees', 'worktree deleted', { branch })
	return true
}
