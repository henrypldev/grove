import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { computeDiff, getHeadSha } from '../api/diff'
import { checkFingerprintAndRebuild, stopExpoBuild } from '../api/expo-build'
import { stopExpoDevServer } from '../api/expo-dev-server'
import { clearTeamPort, getTeamPort } from '../api/ports'
import { createTeamDevice, deleteTeamDevice } from '../api/simulator'
import { unregisterTeamServe } from '../api/tailscale-serve'
import {
	createTaskWorktree,
	deleteWorktree,
	mergeTaskWorktree,
} from '../api/worktrees'
import { log } from '../config'
import { dbInsertActivity, subscribeToTeamActivity } from '../db/activity'
import { dbGetAgent } from '../db/agents'
import { dbGetRepo } from '../db/repos'
import { dbGetTeamDependencies } from '../db/team-dependencies'
import { dbGetTeam, dbUpdateTeamPrUrl, dbUpdateTeamStatus } from '../db/teams'
import type { AgentRole, Team } from '../types'
import {
	closeAgent,
	closeAllAgents,
	closeTaskAgent,
	getAgent,
	getTaskAgent,
	type RegisteredAgent,
} from './agent-registry'
import { resolveUserReply } from './grove-tools'
import { respawnPm, spawnPm } from './pm'
import {
	spawnDeveloper,
	spawnExpoAgent,
	spawnQaAgent,
	spawnReviewerAgent,
	spawnTaskDeveloper,
	spawnTeamLead,
} from './specialists'

/** Valid roles that can be dispatched to. */
const VALID_ROLES = new Set([
	'pm',
	'team-lead',
	'dev',
	'qa',
	'reviewer',
	'expo',
])

const devBaseCommit = new Map<string, string>()

/** Track task worktree paths: Map<teamId:taskId, worktreePath> */
const taskWorktrees = new Map<string, string>()

/** Returns the agent if alive, or undefined after closing a stale one. */
function closeStaleAgent(
	teamId: string,
	role: string,
): RegisteredAgent | undefined {
	const agent = getAgent(teamId, role)
	if (!agent) return undefined

	if (agent.queue.closed) {
		log('orchestrator', `${role} queue closed, cleaning up zombie`, {
			teamId,
		})
		closeAgent(teamId, role)
		return undefined
	}

	const dbAgent = dbGetAgent(agent.agentId)
	if (dbAgent?.status === 'idle' || dbAgent?.status === 'done') {
		log('orchestrator', `${role} is ${dbAgent.status}, closing for respawn`, {
			teamId,
		})
		closeAgent(teamId, role)
		return undefined
	}

	return agent
}

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

function runInstallInBackground(team: Team) {
	const pm = detectPackageManager(team.worktreePath)
	log('orchestrator', `running ${pm} install`, { teamId: team.id })

	const proc = Bun.spawn([pm, 'install'], {
		cwd: team.worktreePath,
		stdout: 'pipe',
		stderr: 'pipe',
	})

	proc.exited.then(exitCode => {
		if (exitCode === 0) {
			log('orchestrator', `${pm} install done`, { teamId: team.id })
			dbInsertActivity(team.id, null, 'deps:installed', { pm })
		} else {
			log('orchestrator', `${pm} install failed`, {
				teamId: team.id,
				exitCode,
			})
			dbInsertActivity(team.id, null, 'deps:install-failed', {
				pm,
				exitCode,
			})
		}
	})
}

export async function startOrchestrator() {
	log('orchestrator', 'starting')
}

export async function onNewTeam(
	team: Team,
	contentBlocks?: SDKUserMessage['message']['content'],
) {
	log('orchestrator', 'spawning team', { teamId: team.id })

	const pmRef = { agentId: '' }
	const { agent: initialPm } = await spawnPm(team, {
		onDone: () => {
			log('orchestrator', 'pm process exited', { teamId: team.id })
			closeAgent(team.id, 'pm', pmRef.agentId)
		},
		onError: () => {
			dbUpdateTeamStatus(team.id, 'blocked')
			closeAgent(team.id, 'pm', pmRef.agentId)
		},
		contentBlocks,
	})
	pmRef.agentId = initialPm.id

	subscribeToTeamActivity(team.id, async event => {
		if (event.type === 'task:complete') {
			let payload: { taskId?: string }
			try {
				payload =
					typeof event.payload === 'string'
						? JSON.parse(event.payload)
						: event.payload
			} catch {
				payload = {}
			}
			if (payload.taskId) {
				log('orchestrator', `task ${payload.taskId} complete, closing task dev`, {
					teamId: team.id,
				})
				closeTaskAgent(team.id, payload.taskId)
			} else {
				log('orchestrator', 'task complete, cycling dev agent', {
					teamId: team.id,
				})
				closeAgent(team.id, 'dev')
			}
		}
	})

	subscribeToTeamActivity(team.id, async event => {
		if (event.type === 'dev:complete') {
			let payload: { summary?: string; taskId?: string }
			try {
				payload =
					typeof event.payload === 'string'
						? JSON.parse(event.payload)
						: event.payload
			} catch {
				payload = {}
			}

			const taskId = payload.taskId
			let diff: string | null = null

			if (taskId) {
				// Parallel dev: merge task worktree back into team worktree
				const wtKey = `${team.id}:${taskId}`
				const taskWtPath = taskWorktrees.get(wtKey)
				if (taskWtPath) {
					// Compute diff from the task worktree before merging
					const base = devBaseCommit.get(wtKey)
					diff = await computeDiff(taskWtPath, base)
					devBaseCommit.delete(wtKey)

					const mergeResult = await mergeTaskWorktree(
						team.worktreePath,
						team.id,
						taskId,
					)
					if (mergeResult !== true) {
						log('orchestrator', 'task merge conflict', {
							teamId: team.id,
							taskId,
							error: mergeResult,
						})
						dbInsertActivity(team.id, event.agentId, 'agent:message', {
							text: `Merge conflict for task ${taskId}: ${mergeResult}`,
						})
						await dispatchToAgent(
							team,
							'pm',
							`Task ${taskId} dev complete but merge conflict: ${mergeResult}. The dev's changes could not be merged automatically.`,
							event.agentId ?? undefined,
						)
						taskWorktrees.delete(wtKey)
						closeTaskAgent(team.id, taskId)
						return
					}
					taskWorktrees.delete(wtKey)
					closeTaskAgent(team.id, taskId)
					log('orchestrator', `task ${taskId} merged successfully`, {
						teamId: team.id,
					})
				}
			} else {
				// Legacy single dev: compute diff from team worktree
				const base = devBaseCommit.get(team.id)
				diff = await computeDiff(team.worktreePath, base)
				devBaseCommit.delete(team.id)
			}

			const summaryText = taskId
				? `Task ${taskId} dev complete. ${payload.summary ?? ''}`
				: `Dev complete. ${payload.summary ?? ''}`

			dbInsertActivity(team.id, event.agentId, 'agent:message', {
				text: summaryText,
				diff: diff ?? undefined,
			})
			await dispatchToAgent(
				team,
				'pm',
				summaryText,
				event.agentId ?? undefined,
			)
		}
		if (event.type === 'dev:pr-created') {
			let payload: { url?: string }
			try {
				payload =
					typeof event.payload === 'string'
						? JSON.parse(event.payload)
						: event.payload
			} catch {
				payload = {}
			}
			if (payload.url) {
				dbUpdateTeamPrUrl(team.id, payload.url)
			}
		}
		if (event.type === 'pm:summary') {
			const summary = (() => {
				try {
					const p =
						typeof event.payload === 'string'
							? JSON.parse(event.payload)
							: event.payload
					return p.summary ?? null
				} catch {
					return null
				}
			})()
			log('orchestrator', 'pm:summary received, team idle', {
				teamId: team.id,
			})
			dbUpdateTeamStatus(team.id, 'idle', summary ?? undefined)
		}
	})

	// Create a simulator device for every team
	createTeamDevice(team.id).catch(err => {
		log('orchestrator', 'simulator creation failed', { teamId: team.id, err })
	})

	// Run package install in background, then post activity to spawn expo agent
	runInstallInBackground(team)

	subscribeToTeamActivity(team.id, async event => {
		if (event.type !== 'deps:installed') return
		const repo = dbGetRepo(team.repoId)
		if (repo?.framework === 'expo' || repo?.needsNativeBuild) {
			spawnExpoAgent(team, repo.id).catch(err => {
				log('orchestrator', 'expo agent spawn failed', {
					teamId: team.id,
					err,
				})
			})
		}
	})
}

/**
 * Dispatch a dev to work on a specific task in its own worktree.
 * Creates a sub-worktree branched off the team's current HEAD.
 */
export async function dispatchToTaskDev(
	team: Team,
	taskId: string,
	message: string,
): Promise<{ dispatched: boolean; error?: string }> {
	const wtKey = `${team.id}:${taskId}`

	// Check if a task dev already exists for this task
	const existing = getTaskAgent(team.id, taskId)
	if (existing && !existing.queue.closed) {
		log('orchestrator', `task dev already running for task ${taskId}`, {
			teamId: team.id,
		})
		existing.queue.push(message)
		return { dispatched: true }
	}

	// Create a sub-worktree for this task
	const result = await createTaskWorktree(team.worktreePath, team.id, taskId)
	if (typeof result === 'string') {
		return { dispatched: false, error: result }
	}

	taskWorktrees.set(wtKey, result.path)
	const sha = await getHeadSha(result.path)
	if (sha) devBaseCommit.set(wtKey, sha)

	log('orchestrator', `spawning task dev for task ${taskId}`, {
		teamId: team.id,
		worktreePath: result.path,
	})

	const persistent = await spawnTaskDeveloper(team, taskId, result.path, {
		onPostBash: makeOnPostBash(team),
	})
	// Send the initial task message
	persistent.queue.push(message)

	return { dispatched: true }
}

/**
 * Dispatch a message to a specific agent role. Used by the `delegate_to` tool
 * and by the activity listener for structured agent-to-agent routing.
 */
export async function dispatchToAgent(
	team: Team,
	targetRole: string,
	text: string,
	senderAgentId?: string,
	contentBlocks?: SDKUserMessage['message']['content'],
): Promise<{ dispatched: boolean; error?: string }> {
	if (!VALID_ROLES.has(targetRole)) {
		return { dispatched: false, error: `Unknown role: ${targetRole}` }
	}

	if (targetRole === 'pm') {
		const pmAgent = closeStaleAgent(team.id, 'pm')
		if (!pmAgent) {
			log('orchestrator', 'pm not found, respawning', { teamId: team.id })
			const { ref, callbacks } = makePmCallbacks(team, contentBlocks)
			const { agent } = await respawnPm(team, text, callbacks)
			ref.agentId = agent.id
			return { dispatched: true }
		}
		if (pmAgent.agentId !== senderAgentId) {
			log('orchestrator', `routing to pm from ${senderAgentId ?? 'user'}`, {
				teamId: team.id,
			})
			if (contentBlocks) {
				pmAgent.queue.pushContent(contentBlocks)
			} else {
				pmAgent.queue.push(text)
			}
		}
		return { dispatched: true }
	}

	let agent = closeStaleAgent(team.id, targetRole)
	if (!agent) {
		await spawnSpecialist(team, targetRole as AgentRole)
		agent = getAgent(team.id, targetRole)
	}
	if (agent && agent.agentId !== senderAgentId) {
		log(
			'orchestrator',
			`routing to ${targetRole} from ${senderAgentId ?? 'user'}`,
			{ teamId: team.id },
		)
		if (contentBlocks) {
			agent.queue.pushContent(contentBlocks)
		} else {
			agent.queue.push(text)
		}
		return { dispatched: true }
	}
	return {
		dispatched: false,
		error: `Failed to spawn or find agent for role: ${targetRole}`,
	}
}

function makePmCallbacks(
	team: Team,
	contentBlocks?: SDKUserMessage['message']['content'],
) {
	const ref = { agentId: '' }
	const callbacks = {
		onDone: () => {
			log('orchestrator', 'pm process exited', { teamId: team.id })
			closeAgent(team.id, 'pm', ref.agentId)
		},
		onError: () => {
			dbUpdateTeamStatus(team.id, 'blocked')
			closeAgent(team.id, 'pm', ref.agentId)
		},
		contentBlocks,
	}
	return { ref, callbacks }
}

/**
 * Route a message to the appropriate agent.
 * If targetRole is specified, dispatch directly to that role.
 * Otherwise, route to PM (default coordinator).
 */
export async function routeMessageToAgents(
	team: Team,
	text: string,
	senderAgentId?: string,
	contentBlocks?: SDKUserMessage['message']['content'],
	targetRole?: string,
) {
	if (!senderAgentId && resolveUserReply(team.id, text)) return

	const role = targetRole ?? 'pm'
	await dispatchToAgent(team, role, text, senderAgentId, contentBlocks)
}

export async function closeTeam(teamId: string) {
	log('orchestrator', 'closing team', { teamId })
	const team = dbGetTeam(teamId)
	closeAllAgents(teamId)
	stopExpoBuild(teamId)
	stopExpoDevServer(teamId)
	await deleteTeamDevice(teamId)
	const port = getTeamPort(teamId)
	if (port) {
		unregisterTeamServe(teamId, port)
		await killPort(port)
		clearTeamPort(teamId)
	}
	dbUpdateTeamStatus(teamId, 'done')
	if (team) {
		const branch = `grove-team-${teamId}`
		await deleteWorktree(team.repoId, branch, true)
	}
}

async function killPort(port: number) {
	try {
		const proc = Bun.spawn(['lsof', '-ti', `:${port}`], {
			stdout: 'pipe',
			stderr: 'ignore',
		})
		const text = await new Response(proc.stdout).text()
		const pids = text.trim().split('\n').filter(Boolean)
		for (const pid of pids) {
			process.kill(Number(pid), 'SIGTERM')
		}
	} catch {}
}

const pendingDevSpawns = new Map<string, Team>()
const depWatchers = new Map<string, Set<string>>()

function watchTeamForCompletion(depTeamId: string, blockedTeamId: string) {
	if (!depWatchers.has(depTeamId)) {
		depWatchers.set(depTeamId, new Set())
		subscribeToTeamActivity(depTeamId, async event => {
			if (event.type !== 'pm:summary') return
			const blocked = depWatchers.get(depTeamId)
			if (!blocked) return
			depWatchers.delete(depTeamId)
			for (const teamId of blocked) {
				const team = pendingDevSpawns.get(teamId)
				if (!team) continue
				const deps = dbGetTeamDependencies(teamId)
				const stillBlocked = deps.some(d => {
					const t = dbGetTeam(d.dependsOnTeamId)
					return t && t.status !== 'idle' && t.status !== 'done'
				})
				if (!stillBlocked) {
					pendingDevSpawns.delete(teamId)
					log('orchestrator', 'dependencies satisfied, spawning dev', {
						teamId,
					})
					await mergeDependencyBranches(team)
					const sha = await getHeadSha(team.worktreePath)
					if (sha) devBaseCommit.set(teamId, sha)
					await spawnDeveloper(team, { onPostBash: makeOnPostBash(team) })
				}
			}
		})
	}
	depWatchers.get(depTeamId)?.add(blockedTeamId)
}

async function mergeDependencyBranches(team: Team) {
	const deps = dbGetTeamDependencies(team.id)
	for (const dep of deps) {
		const depTeam = dbGetTeam(dep.dependsOnTeamId)
		if (!depTeam) continue
		const depBranch = `grove-team-${dep.dependsOnTeamId}`
		log('orchestrator', 'merging dependency branch', {
			teamId: team.id,
			depBranch,
		})
		const result =
			await Bun.$`git -C ${team.worktreePath} merge ${depBranch} --no-edit`
				.quiet()
				.nothrow()
		if (result.exitCode !== 0) {
			log('orchestrator', 'dependency merge failed', {
				teamId: team.id,
				depBranch,
				stderr: result.stderr.toString(),
			})
		}
	}
}

function makeOnPostBash(team: Team): ((command: string) => void) | undefined {
	const repo = dbGetRepo(team.repoId)
	if (!repo?.needsNativeBuild) return undefined

	const installPattern =
		/\b(npm install|yarn add|pnpm add|bun add|bun install|expo install)\b/
	return (command: string) => {
		if (installPattern.test(command)) {
			log('orchestrator', 'detected package install, checking fingerprint', {
				teamId: team.id,
			})
			checkFingerprintAndRebuild(team.id, team.worktreePath, team.repoId)
		}
	}
}

async function spawnSpecialist(team: Team, role: AgentRole) {
	log('orchestrator', `spawning specialist ${role}`, { teamId: team.id })
	if (role === 'team-lead') await spawnTeamLead(team)
	else if (role === 'dev') {
		const deps = dbGetTeamDependencies(team.id)
		const unsatisfied = deps.filter(d => {
			const depTeam = dbGetTeam(d.dependsOnTeamId)
			return depTeam && depTeam.status !== 'idle' && depTeam.status !== 'done'
		})
		if (unsatisfied.length > 0) {
			log('orchestrator', 'dev blocked by dependencies', {
				teamId: team.id,
				deps: unsatisfied.map(d => d.dependsOnTeamId),
			})
			pendingDevSpawns.set(team.id, team)
			for (const dep of unsatisfied) {
				watchTeamForCompletion(dep.dependsOnTeamId, team.id)
			}
			dbInsertActivity(team.id, null, 'agent:message', {
				text: 'Dev work is waiting for dependent teams to complete.',
			})
			await dispatchToAgent(
				team,
				'pm',
				'Dev work is waiting for dependent teams to complete.',
			)
			return
		}
		if (deps.length > 0) await mergeDependencyBranches(team)
		const sha = await getHeadSha(team.worktreePath)
		if (sha) devBaseCommit.set(team.id, sha)
		await spawnDeveloper(team, { onPostBash: makeOnPostBash(team) })
	} else if (role === 'qa') await spawnQaAgent(team)
	else if (role === 'reviewer') await spawnReviewerAgent(team)
	else if (role === 'expo') {
		const repo = dbGetRepo(team.repoId)
		if (repo) await spawnExpoAgent(team, repo.id)
	}
}
