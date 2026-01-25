import { spawn } from 'bun'
import { join } from 'path'
import { loadConfig } from '../config'

export interface Worktree {
  path: string
  branch: string
  isMain: boolean
}

export async function getWorktrees(repoId: string): Promise<Worktree[]> {
  const config = loadConfig()
  const repo = config.repos.find((r) => r.id === repoId)
  if (!repo) {
    return []
  }

  const proc = spawn({
    cmd: ['git', 'worktree', 'list', '--porcelain'],
    cwd: repo.path,
    stdout: 'pipe',
    stderr: 'ignore',
  })

  const output = await new Response(proc.stdout).text()
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

  return worktrees
}

export async function createWorktree(
  repoId: string,
  branch: string,
  baseBranch: string
): Promise<Worktree | null> {
  const config = loadConfig()
  const repo = config.repos.find((r) => r.id === repoId)
  if (!repo) {
    return null
  }

  const worktreePath = join(repo.path, '..', `${repo.name}-${branch}`)

  const proc = spawn({
    cmd: ['git', 'worktree', 'add', '-b', branch, worktreePath, baseBranch],
    cwd: repo.path,
    stdout: 'ignore',
    stderr: 'pipe',
  })

  await proc.exited

  if (proc.exitCode !== 0) {
    return null
  }

  return {
    path: worktreePath,
    branch,
    isMain: false,
  }
}
