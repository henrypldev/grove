import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { dbInsertActivity, dbListActivitySince } from '../db/activity'
import { dbGetNote, dbUpsertNote } from '../db/agent-notes'
import { dbInsertTasks, dbListTasks, dbUpdateTask } from '../db/agent-tasks'
import { dbUpdateAgentStatus } from '../db/agents'
import { dbGetDesignDoc, dbUpsertDesignDoc } from '../db/design-docs'
import { dbGetPrd, dbUpsertPrd } from '../db/prds'
import { dbGetTeam, dbListTeams } from '../db/teams'

interface QuestionOption {
	label: string
	description: string
}

interface Question {
	question: string
	header: string
	options: QuestionOption[]
	multiSelect: boolean
}

const pendingUserReplies = new Map<
	string,
	(answers: Record<string, string>) => void
>()

export function resolveUserReply(
	teamId: string,
	answers: Record<string, string> | string,
): boolean {
	const resolve = pendingUserReplies.get(teamId)
	if (!resolve) return false
	pendingUserReplies.delete(teamId)
	if (typeof answers === 'string') {
		resolve({ _raw: answers })
	} else {
		resolve(answers)
	}
	return true
}

export function waitForUserReply(
	teamId: string,
	agentId: string,
	questions: Question[],
): Promise<Record<string, string>> {
	dbInsertActivity(teamId, agentId, 'pm:questions', { questions })
	dbUpdateAgentStatus(agentId, 'waiting')
	return new Promise<Record<string, string>>(resolve => {
		pendingUserReplies.set(teamId, (answers: Record<string, string>) => {
			dbUpdateAgentStatus(agentId, 'working')
			resolve(answers)
		})
	})
}

function parseConflictFiles(mergeTreeOutput: string): string[] {
	const files: string[] = []
	for (const line of mergeTreeOutput.split('\n')) {
		if (line.includes('CONFLICT')) {
			const match = line.match(/CONFLICT \([^)]+\): (.+)/)
			if (match) files.push(match[1].trim())
		}
	}
	return files
}

export function createGroveTools(teamId: string, agentId: string) {
	return createSdkMcpServer({
		name: 'grove',
		version: '1.0.0',
		tools: [
			tool(
				'post_activity',
				'Post an activity entry to this team',
				{
					type: z
						.string()
						.describe('Event type, e.g. "pm:plan" or "agent:message"'),
					payload: z
						.record(z.string(), z.unknown())
						.describe('Event payload as a JSON object'),
				},
				async ({ type, payload }) => {
					dbInsertActivity(
						teamId,
						agentId,
						type,
						payload as Record<string, unknown>,
					)
					return { content: [{ type: 'text' as const, text: 'ok' }] }
				},
			),
			tool(
				'get_activity',
				'Get all team activity since a timestamp',
				{
					since: z
						.number()
						.optional()
						.describe('Unix ms timestamp. Defaults to 0 (all activity)'),
				},
				async ({ since }) => {
					const items = dbListActivitySince(teamId, since ?? 0)
					const parsed = items.map(e => ({
						...e,
						payload: JSON.parse(e.payload),
					}))
					return {
						content: [{ type: 'text' as const, text: JSON.stringify(parsed) }],
					}
				},
			),
			tool(
				'save_prd',
				'Store a PRD in the database',
				{
					content: z.string().describe('The full PRD content in markdown'),
				},
				async ({ content }) => {
					dbUpsertPrd(teamId, agentId, content)
					dbInsertActivity(teamId, agentId, 'prd:ready', {})
					return {
						content: [{ type: 'text' as const, text: 'saved prd' }],
					}
				},
			),
			tool('get_prd', 'Retrieve the PRD for this team', {}, async () => {
				const prd = dbGetPrd(teamId)
				if (!prd) {
					return {
						content: [{ type: 'text' as const, text: 'no prd found' }],
					}
				}
				return { content: [{ type: 'text' as const, text: prd.content }] }
			}),
			tool(
				'save_design_doc',
				'Store a technical design doc in the database',
				{
					content: z
						.string()
						.describe('The full design doc content in markdown'),
				},
				async ({ content }) => {
					dbUpsertDesignDoc(teamId, agentId, content)
					dbInsertActivity(teamId, agentId, 'design_doc:ready', {})
					return {
						content: [{ type: 'text' as const, text: 'saved design doc' }],
					}
				},
			),
			tool(
				'get_design_doc',
				'Retrieve the technical design doc for this team',
				{},
				async () => {
					const doc = dbGetDesignDoc(teamId)
					if (!doc) {
						return {
							content: [{ type: 'text' as const, text: 'no design doc found' }],
						}
					}
					return { content: [{ type: 'text' as const, text: doc.content }] }
				},
			),
			tool(
				'create_tasks',
				'Create tasks for this team',
				{
					tasks: z
						.array(
							z.object({
								id_string: z.string().describe('Task ID (e.g. "1", "2")'),
								title: z.string().describe('Task title'),
								priority: z.number().describe('Priority (lower = higher)'),
							}),
						)
						.describe('Array of tasks to create'),
				},
				async ({ tasks }) => {
					dbInsertTasks(
						teamId,
						tasks.map(t => ({
							idString: t.id_string,
							title: t.title,
							priority: t.priority,
						})),
					)
					return {
						content: [
							{
								type: 'text' as const,
								text: `created ${tasks.length} tasks`,
							},
						],
					}
				},
			),
			tool('get_tasks', 'Get all tasks for this team', {}, async () => {
				const tasks = dbListTasks(teamId)
				return {
					content: [{ type: 'text' as const, text: JSON.stringify(tasks) }],
				}
			}),
			tool(
				'update_task',
				'Update a task by its ID string',
				{
					id_string: z.string().describe('Task ID (e.g. "1", "2")'),
					status: z
						.enum(['pending', 'in_progress', 'complete', 'skipped'])
						.optional()
						.describe('New status'),
					blocked_by: z
						.array(z.string())
						.optional()
						.describe('Array of task ID strings this task is blocked by'),
				},
				async ({ id_string, status, blocked_by }) => {
					dbUpdateTask(teamId, id_string, {
						status: status ?? undefined,
						blockedBy: blocked_by ?? undefined,
					})
					return {
						content: [
							{ type: 'text' as const, text: `updated task ${id_string}` },
						],
					}
				},
			),
			tool(
				'save_note',
				'Store a note (e.g. progress log) in the database',
				{
					content: z.string().describe('The note content in markdown'),
				},
				async ({ content }) => {
					dbUpsertNote(teamId, agentId, content)
					return {
						content: [{ type: 'text' as const, text: 'saved note' }],
					}
				},
			),
			tool('get_notes', 'Retrieve the notes for this team', {}, async () => {
				const note = dbGetNote(teamId)
				if (!note) {
					return {
						content: [{ type: 'text' as const, text: 'no notes found' }],
					}
				}
				return { content: [{ type: 'text' as const, text: note.content }] }
			}),
			tool(
				'append_note',
				'Append an entry to the team notes. Accumulates across tasks.',
				{
					entry: z
						.string()
						.describe(
							'Note entry in markdown (## task title, changes, learnings, gotchas)',
						),
				},
				async ({ entry }) => {
					const existing = dbGetNote(teamId)
					const content = existing ? `${existing.content}\n\n${entry}` : entry
					dbUpsertNote(teamId, agentId, content)
					return {
						content: [{ type: 'text' as const, text: 'note updated' }],
					}
				},
			),
			tool(
				'check_conflicts',
				'Check git conflicts between this team and main/other teams',
				{},
				async () => {
					const team = dbGetTeam(teamId)
					if (!team) {
						return {
							content: [{ type: 'text' as const, text: 'team not found' }],
						}
					}
					const results: Record<string, string[]> = {}
					try {
						const mergeBase = Bun.spawnSync(
							['git', 'merge-base', 'HEAD', 'origin/main'],
							{ cwd: team.worktreePath },
						)
						const base = mergeBase.stdout.toString().trim()
						if (base) {
							const mainCheck = Bun.spawnSync(
								['git', 'merge-tree', base, 'HEAD', 'origin/main'],
								{ cwd: team.worktreePath },
							)
							const mainOutput = mainCheck.stdout.toString()
							const mainConflicts = parseConflictFiles(mainOutput)
							if (mainConflicts.length > 0) results.main = mainConflicts
						}
					} catch {}
					const allTeams = dbListTeams().filter(t => t.id !== teamId)
					for (const other of allTeams) {
						try {
							Bun.spawnSync(['git', 'fetch', 'origin'], {
								cwd: team.worktreePath,
							})
							const branchName = `grove-team-${other.id}`
							const mergeBase = Bun.spawnSync(
								['git', 'merge-base', 'HEAD', `origin/${branchName}`],
								{ cwd: team.worktreePath },
							)
							const base = mergeBase.stdout.toString().trim()
							if (!base) continue
							const check = Bun.spawnSync(
								['git', 'merge-tree', base, 'HEAD', `origin/${branchName}`],
								{ cwd: team.worktreePath },
							)
							const output = check.stdout.toString()
							const conflicts = parseConflictFiles(output)
							if (conflicts.length > 0) results[`team-${other.id}`] = conflicts
						} catch {}
					}
					return {
						content: [
							{
								type: 'text' as const,
								text: JSON.stringify(results),
							},
						],
					}
				},
			),
		],
	})
}
