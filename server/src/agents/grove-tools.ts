import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { dbUpdateAgentStatus } from '../db/agents'
import { dbInsertEvent, dbListEventsSince } from '../db/events'
import { dbGetPlan, dbInsertPlan } from '../db/plans'
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
	dbInsertEvent(teamId, agentId, 'pm:questions', { questions })
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
				'post_event',
				'Post an event to this team',
				{
					type: z
						.string()
						.describe('Event type, e.g. "pm:plan" or "agent:message"'),
					payload: z
						.record(z.string(), z.unknown())
						.describe('Event payload as a JSON object'),
				},
				async ({ type, payload }) => {
					dbInsertEvent(
						teamId,
						agentId,
						type,
						payload as Record<string, unknown>,
					)
					return { content: [{ type: 'text' as const, text: 'ok' }] }
				},
			),
			tool(
				'get_events',
				'Get all team events since a timestamp',
				{
					since: z
						.number()
						.optional()
						.describe('Unix ms timestamp. Defaults to 0 (all events)'),
				},
				async ({ since }) => {
					const events = dbListEventsSince(teamId, since ?? 0)
					const parsed = events.map(e => ({
						...e,
						payload: JSON.parse(e.payload),
					}))
					return {
						content: [{ type: 'text' as const, text: JSON.stringify(parsed) }],
					}
				},
			),
			tool(
				'save_plan',
				'Store a PRD or technical plan in the database',
				{
					type: z
						.enum(['prd', 'technical', 'stories', 'progress'])
						.describe('Plan type'),
					content: z.string().describe('The full plan content in markdown'),
				},
				async ({ type, content }) => {
					dbInsertPlan(teamId, agentId, type, content)
					return {
						content: [{ type: 'text' as const, text: `saved ${type} plan` }],
					}
				},
			),
			tool(
				'get_plan',
				'Retrieve the latest plan of a given type',
				{
					type: z
						.enum(['prd', 'technical', 'stories', 'progress'])
						.describe('Plan type to retrieve'),
				},
				async ({ type }) => {
					const plan = dbGetPlan(teamId, type)
					if (!plan) {
						return {
							content: [
								{ type: 'text' as const, text: `no ${type} plan found` },
							],
						}
					}
					return { content: [{ type: 'text' as const, text: plan.content }] }
				},
			),
			tool(
				'append_progress',
				'Append a progress entry for the current task. Accumulates across tasks.',
				{
					entry: z
						.string()
						.describe(
							'Progress entry in markdown (## task title, changes, learnings, gotchas)',
						),
				},
				async ({ entry }) => {
					const existing = dbGetPlan(teamId, 'progress')
					const content = existing ? `${existing.content}\n\n${entry}` : entry
					dbInsertPlan(teamId, agentId, 'progress', content)
					return {
						content: [{ type: 'text' as const, text: 'progress updated' }],
					}
				},
			),
			tool(
				'update_story',
				'Update the status of a single task in the tasks plan',
				{
					id: z.string().describe('Task ID (e.g. "1", "2")'),
					status: z
						.enum(['pending', 'in_progress', 'complete', 'skipped'])
						.describe('New status'),
				},
				async ({ id, status }) => {
					const plan = dbGetPlan(teamId, 'stories')
					if (!plan) {
						return {
							content: [{ type: 'text' as const, text: 'no tasks plan found' }],
						}
					}
					const stories = JSON.parse(plan.content)
					const story = stories.find((s: { id: string }) => s.id === id)
					if (!story) {
						return {
							content: [
								{ type: 'text' as const, text: `task ${id} not found` },
							],
						}
					}
					story.status = status
					dbInsertPlan(teamId, agentId, 'stories', JSON.stringify(stories))
					return {
						content: [{ type: 'text' as const, text: `${id} → ${status}` }],
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
