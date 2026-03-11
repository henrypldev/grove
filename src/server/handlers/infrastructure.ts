import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { stopExpoBuild } from '../api/expo-build'
import { stopExpoDevServer } from '../api/expo-dev-server'
import { clearTeamPort, getTeamPort, killProcessOnPort } from '../api/ports'
import { createTeamDevice, deleteTeamDevice } from '../api/simulator'
import { unregisterTeamServe } from '../api/tailscale-serve'
import { deleteWorktree } from '../api/worktrees'
import { log } from '../config'
import { dbInsertActivity } from '../db/activity'
import { dbGetTeam } from '../db/teams'
import type { TeamActivity } from '../types'
import type { Handler } from './types'

function detectPackageManager(worktreePath: string): string {
	if (
		existsSync(join(worktreePath, 'bun.lockb')) ||
		existsSync(join(worktreePath, 'bun.lock'))
	)
		return 'bun'
	if (existsSync(join(worktreePath, 'pnpm-lock.yaml'))) return 'pnpm'
	if (existsSync(join(worktreePath, 'yarn.lock'))) return 'yarn'
	return 'npm'
}

function runInstallInBackground(teamId: string, worktreePath: string) {
	const pm = detectPackageManager(worktreePath)
	log('handler', `running ${pm} install`, { teamId })

	const proc = Bun.spawn([pm, 'install'], {
		cwd: worktreePath,
		stdout: 'pipe',
		stderr: 'pipe',
	})

	proc.exited.then(exitCode => {
		if (exitCode === 0) {
			log('handler', `${pm} install done`, { teamId })
			dbInsertActivity(teamId, null, 'deps:installed', { pm })
		} else {
			log('handler', `${pm} install failed`, { teamId, exitCode })
			dbInsertActivity(teamId, null, 'deps:install-failed', {
				pm,
				exitCode,
			})
		}
	})
}

export const infrastructureHandler: Handler = {
	name: 'infrastructure',
	handles: ['deps:installed'],

	async onTeamCreated(teamId: string) {
		const team = dbGetTeam(teamId)
		if (!team) return

		// Create a simulator device for every team
		createTeamDevice(teamId).catch(err => {
			log('handler', 'simulator creation failed', { teamId, err })
		})

		// Run package install in background
		runInstallInBackground(teamId, team.worktreePath)
	},

	async onActivity(_teamId: string, _event: TeamActivity) {
		// deps:installed is handled — currently the expo agent spawn is commented out
		// Placeholder for future use when expo agent is re-enabled
	},

	async onTeamClosing(teamId: string) {
		const team = dbGetTeam(teamId)

		stopExpoBuild(teamId)
		stopExpoDevServer(teamId)
		await deleteTeamDevice(teamId)

		const port = getTeamPort(teamId)
		if (port) {
			unregisterTeamServe(teamId, port)
			await killProcessOnPort(port)
			clearTeamPort(teamId)
		}

		if (team) {
			const branch = `grove-team-${teamId}`
			await deleteWorktree(team.repoId, branch, true)
		}
	},
}
