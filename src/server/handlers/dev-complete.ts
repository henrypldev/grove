import { closeTaskAgent } from '../agents/agent-registry'
import { dispatchToAgent } from '../agents/orchestrator'
import { computeDiff, type DiffResult } from '../api/diff'
import { mergeTaskWorktree } from '../api/worktrees'
import { log } from '../config'
import { dbInsertActivity } from '../db/activity'
import { dbUpdateTask } from '../db/agent-tasks'
import { dbUpdateAgentBaseCommit } from '../db/agents'
import { dbGetTeam, dbUpdateTeamPrUrl } from '../db/teams'
import type { TeamActivity } from '../types'
import { type Handler, parsePayload } from './types'

/** Track base commit SHA for diff computation: Map<teamId or teamId:taskId, sha> */
const devBaseCommit = new Map<string, string>()

/** Track task worktree paths: Map<teamId:taskId, worktreePath> */
const taskWorktrees = new Map<string, string>()

export function setDevBaseCommit(key: string, sha: string, agentId?: string) {
	devBaseCommit.set(key, sha)
	if (agentId) {
		dbUpdateAgentBaseCommit(agentId, sha)
	}
}

export function getDevBaseCommitSha(key: string): string | undefined {
	return devBaseCommit.get(key)
}

export function setTaskWorktree(
	key: string,
	path: string,
	teamId?: string,
	taskId?: string,
) {
	taskWorktrees.set(key, path)
	if (teamId && taskId) {
		dbUpdateTask(teamId, taskId, { worktreePath: path })
	}
}

export function getTaskWorktreePath(key: string): string | undefined {
	return taskWorktrees.get(key)
}

/** Restore in-memory maps from DB data (used during recovery). */
export function restoreDevBaseCommit(key: string, sha: string) {
	devBaseCommit.set(key, sha)
}

export function restoreTaskWorktree(key: string, path: string) {
	taskWorktrees.set(key, path)
}

export const devCompleteHandler: Handler = {
	name: 'dev-complete',
	handles: ['dev:complete', 'dev:pr-created'],

	async onActivity(teamId: string, event: TeamActivity) {
		if (event.type === 'dev:complete') {
			const payload = parsePayload<{ summary?: string; taskId?: string }>(
				event.payload,
			)

			const team = dbGetTeam(teamId)
			if (!team) return

			const taskId = payload.taskId
			let diff: DiffResult | null = null

			if (taskId) {
				const wtKey = `${teamId}:${taskId}`
				const taskWtPath = taskWorktrees.get(wtKey)
				if (taskWtPath) {
					try {
						const base = devBaseCommit.get(wtKey)
						diff = await computeDiff(taskWtPath, base)

						const mergeResult = await mergeTaskWorktree(
							team.worktreePath,
							teamId,
							taskId,
						)
						if (mergeResult !== true) {
							log('handler', 'task merge conflict', {
								teamId,
								taskId,
								error: mergeResult,
							})
							dbInsertActivity(teamId, event.agentId, 'agent:message', {
								text: `Merge conflict for task ${taskId}: ${mergeResult}`,
							})
							await dispatchToAgent(
								team,
								'pm',
								`Task ${taskId} dev complete but merge conflict: ${mergeResult}. The dev's changes could not be merged automatically.`,
								event.agentId ?? undefined,
							)
							return
						}
						log('handler', `task ${taskId} merged successfully`, { teamId })
					} finally {
						devBaseCommit.delete(wtKey)
						taskWorktrees.delete(wtKey)
						closeTaskAgent(teamId, taskId)
					}
				}
			} else {
				const base = devBaseCommit.get(teamId)
				diff = await computeDiff(team.worktreePath, base)
				devBaseCommit.delete(teamId)
			}

			const summaryText = taskId
				? `Task ${taskId} dev complete. ${payload.summary ?? ''}`
				: `Dev complete. ${payload.summary ?? ''}`

			dbInsertActivity(teamId, event.agentId, 'agent:message', {
				text: summaryText,
				diff: diff ?? undefined,
			})
			await dispatchToAgent(team, 'pm', summaryText, event.agentId ?? undefined)
		}

		if (event.type === 'dev:pr-created') {
			const payload = parsePayload<{ url?: string }>(event.payload)
			if (payload.url) {
				dbUpdateTeamPrUrl(teamId, payload.url)
			}
		}
	},
}
