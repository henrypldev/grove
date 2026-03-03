import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { computeDiff, getHeadSha } from '../api/diff'
import { checkFingerprintAndRebuild, stopExpoBuild } from '../api/expo-build'
import { stopExpoDevServer } from '../api/expo-dev-server'
import { clearTeamPort, getTeamPort } from '../api/ports'
import { deleteTeamDevice } from '../api/simulator'
import { unregisterTeamServe } from '../api/tailscale-serve'
import { deleteWorktree } from '../api/worktrees'
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
	getAgent,
	type RegisteredAgent,
} from './agent-registry'
import { resolveUserReply } from './grove-tools'
import { respawnPm, spawnPm } from './pm'
import {
	spawnDeveloper,
	spawnQaAgent,
	spawnReviewerAgent,
	spawnTeamLead,
} from './specialists'

const MENTION_PATTERN = /@(pm|team-lead|dev|qa|reviewer)\b/g

const devBaseCommit = new Map<string, string>()

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
}

export async function onNewTeam(
	team: Team,
	contentBlocks?: SDKUserMessage['message']['content'],
) {
	log('orchestrator', 'spawning team', { teamId: team.id })

	await spawnPm(team, {
		onDone: () => {
			log('orchestrator', 'pm process exited', { teamId: team.id })
			closeAgent(team.id, 'pm')
		},
		onError: () => {
			dbUpdateTeamStatus(team.id, 'blocked')
			closeAgent(team.id, 'pm')
		},
		contentBlocks,
	})

	subscribeToTeamActivity(team.id, async event => {
		if (event.type !== 'agent:message') return

		let payload: { text?: string }
		try {
			payload =
				typeof event.payload === 'string'
					? JSON.parse(event.payload)
					: event.payload
		} catch {
			return
		}

		const text = payload.text
		if (!text) return

		await routeMessageToAgents(team, text, event.agentId ?? undefined)
	})

	subscribeToTeamActivity(team.id, async event => {
		if (event.type === 'task:complete') {
			log('orchestrator', 'task complete, cycling dev agent', {
				teamId: team.id,
			})
			closeAgent(team.id, 'dev')
		}
	})

	subscribeToTeamActivity(team.id, async event => {
		if (event.type === 'dev:complete') {
			let payload: { summary?: string }
			try {
				payload =
					typeof event.payload === 'string'
						? JSON.parse(event.payload)
						: event.payload
			} catch {
				payload = {}
			}
			const base = devBaseCommit.get(team.id)
			const diff = await computeDiff(team.worktreePath, base)
			devBaseCommit.delete(team.id)
			dbInsertActivity(team.id, event.agentId, 'agent:message', {
				text: `@pm done. ${payload.summary ?? ''}`,
				diff: diff ?? undefined,
			})
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
}

export async function routeMessageToAgents(
	team: Team,
	text: string,
	senderAgentId?: string,
	contentBlocks?: SDKUserMessage['message']['content'],
) {
	if (!senderAgentId && resolveUserReply(team.id, text)) return

	const mentions = new Set<string>()
	for (const match of text.matchAll(MENTION_PATTERN)) {
		mentions.add(match[1])
	}

	const pmCallbacks = {
		onDone: () => {
			log('orchestrator', 'pm process exited', { teamId: team.id })
			closeAgent(team.id, 'pm')
		},
		onError: () => {
			dbUpdateTeamStatus(team.id, 'blocked')
			closeAgent(team.id, 'pm')
		},
		contentBlocks,
	}

	if (mentions.size === 0) {
		const pmAgent = closeStaleAgent(team.id, 'pm')
		if (!pmAgent) {
			log('orchestrator', 'pm not found, respawning', { teamId: team.id })
			await respawnPm(team, text, pmCallbacks)
			return
		}
		if (pmAgent.agentId !== senderAgentId) {
			log(
				'orchestrator',
				`routing to pm (default) from ${senderAgentId ?? 'user'}`,
				{
					teamId: team.id,
				},
			)
			if (contentBlocks) {
				pmAgent.queue.pushContent(contentBlocks)
			} else {
				pmAgent.queue.push(text)
			}
		}
		return
	}

	for (const role of mentions) {
		if (role === 'pm') {
			const pmAgent = closeStaleAgent(team.id, 'pm')
			if (!pmAgent) {
				log('orchestrator', 'pm not found, respawning', { teamId: team.id })
				await respawnPm(team, text, pmCallbacks)
				continue
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
			continue
		}

		let agent = closeStaleAgent(team.id, role)
		if (!agent) {
			await spawnSpecialist(team, role as AgentRole)
			agent = getAgent(team.id, role)
		}
		if (agent && agent.agentId !== senderAgentId) {
			log(
				'orchestrator',
				`routing to ${role} from ${senderAgentId ?? 'user'}`,
				{
					teamId: team.id,
				},
			)
			if (contentBlocks) {
				agent.queue.pushContent(contentBlocks)
			} else {
				agent.queue.push(text)
			}
		}
	}
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
				text: '@pm Dev work is waiting for dependent teams to complete.',
			})
			return
		}
		if (deps.length > 0) await mergeDependencyBranches(team)
		const sha = await getHeadSha(team.worktreePath)
		if (sha) devBaseCommit.set(team.id, sha)
		await spawnDeveloper(team, { onPostBash: makeOnPostBash(team) })
	} else if (role === 'qa') await spawnQaAgent(team)
	else if (role === 'reviewer') await spawnReviewerAgent(team)
}
