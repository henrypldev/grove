import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { getHeadSha } from '../api/diff'
import { createTaskWorktree } from '../api/worktrees'
import { log } from '../config'
import { dbInsertActivity, subscribeToTeamActivity } from '../db/activity'
import { dbUpdateTask } from '../db/agent-tasks'
import { dbGetAgent } from '../db/agents'
import { dbGetTeamDependencies } from '../db/team-dependencies'
import { dbGetTeam, dbUpdateTeamStatus } from '../db/teams'
import { GitOperationError, TaskDevLimitError } from '../errors'
import {
	initHandlersForTeam,
	registerHandler,
	teardownHandlersForTeam,
} from '../handlers'
import { agentLifecycleHandler } from '../handlers/agent-lifecycle'
import {
	devCompleteHandler,
	setDevBaseCommit,
	setTaskWorktree,
} from '../handlers/dev-complete'
import { infrastructureHandler } from '../handlers/infrastructure'
import type { AgentRole, Team } from '../types'
import {
	closeAgent,
	closeAllAgents,
	getAgent,
	getAllTaskAgents,
	getTaskAgent,
	type RegisteredAgent,
} from './agent-registry'
import { resolveUserReply } from './grove-tools'
import { makeOnPostBash } from './helpers'
import { respawnPm, spawnPm } from './pm'
import {
	spawnDeveloper,
	spawnReviewerAgent,
	spawnTaskDeveloper,
	spawnTeamLead,
} from './specialists'

/** Valid roles that can be dispatched to. */
const VALID_ROLES = new Set(['pm', 'team-lead', 'dev', 'reviewer'])

/** Maximum number of concurrent task dev agents per team. */
const MAX_TASK_DEVS = 4

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

export async function startOrchestrator() {
	log('orchestrator', 'starting')

	// Register all handlers
	registerHandler(agentLifecycleHandler)
	registerHandler(devCompleteHandler)
	registerHandler(infrastructureHandler)
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

	// Initialize all handlers for this team (subscriptions + onTeamCreated hooks)
	await initHandlersForTeam(team.id)
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

	// Enforce max concurrent task devs
	const activeTaskDevs = getAllTaskAgents(team.id)
	const activeCount = [...activeTaskDevs.values()].filter(
		a => !a.queue.closed,
	).length
	if (activeCount >= MAX_TASK_DEVS) {
		const limitErr = new TaskDevLimitError({
			teamId: team.id,
			taskId,
			activeCount,
			maxCount: MAX_TASK_DEVS,
		})
		log('orchestrator', 'task dev limit reached', { error: limitErr })
		return {
			dispatched: false,
			error: `Maximum concurrent task devs (${MAX_TASK_DEVS}) reached. Wait for a task to complete before starting another.`,
		}
	}

	// Create a sub-worktree for this task
	const result = await createTaskWorktree(team.worktreePath, team.id, taskId)
	if (typeof result === 'string') {
		return { dispatched: false, error: result }
	}

	setTaskWorktree(wtKey, result.path, team.id, taskId)

	log('orchestrator', `spawning task dev for task ${taskId}`, {
		teamId: team.id,
		worktreePath: result.path,
	})

	// Mark task as in_progress
	dbUpdateTask(team.id, taskId, { status: 'in_progress' })

	const persistent = await spawnTaskDeveloper(team, taskId, result.path, {
		onPostBash: makeOnPostBash(team),
	})

	const sha = await getHeadSha(result.path)
	if (sha) setDevBaseCommit(wtKey, sha, persistent.agent.id)

	// Link the agent to the task in the DB
	dbUpdateTask(team.id, taskId, { agentId: persistent.agent.id })
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

	// Re-activate team when user sends a new message
	if (!senderAgentId && (team.status === 'done' || team.status === 'idle')) {
		dbUpdateTeamStatus(team.id, 'active')
	}

	const role = targetRole ?? 'pm'
	await dispatchToAgent(team, role, text, senderAgentId, contentBlocks)
}

export async function closeTeam(teamId: string) {
	log('orchestrator', 'closing team', { teamId })
	closeAllAgents(teamId)
	pendingDevSpawns.delete(teamId)
	for (const [depTeamId, blocked] of depWatchers) {
		blocked.delete(teamId)
		if (blocked.size === 0) depWatchers.delete(depTeamId)
	}
	await teardownHandlersForTeam(teamId)
	dbUpdateTeamStatus(teamId, 'archived')
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
					return t && t.status !== 'done'
				})
				if (!stillBlocked) {
					pendingDevSpawns.delete(teamId)
					log('orchestrator', 'dependencies satisfied, spawning dev', {
						teamId,
					})
					await mergeDependencyBranches(team)
					const sha = await getHeadSha(team.worktreePath)
					if (sha) setDevBaseCommit(teamId, sha)
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
			const mergeErr = new GitOperationError({
				operation: 'merge-dependency',
				teamId: team.id,
				stderr: result.stderr.toString(),
				exitCode: result.exitCode,
			})
			log('orchestrator', 'dependency merge failed', {
				depBranch,
				error: mergeErr,
			})
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
			return depTeam && depTeam.status !== 'done'
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
		if (sha) setDevBaseCommit(team.id, sha)
		await spawnDeveloper(team, { onPostBash: makeOnPostBash(team) })
	} else if (role === 'reviewer') await spawnReviewerAgent(team)
}
