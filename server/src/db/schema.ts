import {
	index,
	integer,
	real,
	sqliteTable,
	text,
} from 'drizzle-orm/sqlite-core'

export const repos = sqliteTable('repos', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	path: text('path').notNull(),
	githubUrl: text('github_url'),
	envVars: text('env_vars'),
	setupSteps: text('setup_steps'),
	addedAt: integer('added_at').notNull(),
})

export const teams = sqliteTable('teams', {
	id: text('id').primaryKey(),
	repoId: text('repo_id')
		.notNull()
		.references(() => repos.id),
	worktreePath: text('worktree_path').notNull(),
	task: text('task').notNull(),
	title: text('title'),
	status: text('status').notNull(),
	pmSummary: text('pm_summary'),
	port: integer('port'),
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull(),
})

export const agents = sqliteTable('agents', {
	id: text('id').primaryKey(),
	teamId: text('team_id')
		.notNull()
		.references(() => teams.id),
	role: text('role').notNull(),
	status: text('status').notNull(),
	activity: text('activity'),
	currentTask: text('current_task'),
	sessionId: text('session_id'),
	retryCount: integer('retry_count').default(0),
	spawnedAt: integer('spawned_at').notNull(),
	updatedAt: integer('updated_at').notNull(),
})

export const events = sqliteTable(
	'events',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		teamId: text('team_id')
			.notNull()
			.references(() => teams.id),
		agentId: text('agent_id').references(() => agents.id),
		type: text('type').notNull(),
		payload: text('payload').notNull(),
		createdAt: integer('created_at').notNull(),
	},
	table => [
		index('idx_events_team_created').on(table.teamId, table.createdAt),
		index('idx_events_agent_created').on(table.agentId, table.createdAt),
	],
)

export const pmReports = sqliteTable('pm_reports', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	teamId: text('team_id')
		.notNull()
		.references(() => teams.id),
	summary: text('summary').notNull(),
	createdAt: integer('created_at').notNull(),
})

export const usage = sqliteTable(
	'usage',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		teamId: text('team_id')
			.notNull()
			.references(() => teams.id),
		agentId: text('agent_id').references(() => agents.id),
		model: text('model').notNull(),
		inputTokens: integer('input_tokens').notNull(),
		outputTokens: integer('output_tokens').notNull(),
		cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
		cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
		costUsd: real('cost_usd').notNull(),
		durationMs: integer('duration_ms').notNull(),
		durationApiMs: integer('duration_api_ms').notNull(),
		numTurns: integer('num_turns').notNull(),
		createdAt: integer('created_at').notNull(),
	},
	table => [
		index('idx_usage_created').on(table.createdAt),
		index('idx_usage_team_created').on(table.teamId, table.createdAt),
	],
)

export const plans = sqliteTable('plans', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	teamId: text('team_id')
		.notNull()
		.references(() => teams.id),
	type: text('type').notNull(),
	agentId: text('agent_id').notNull(),
	content: text('content').notNull(),
	createdAt: integer('created_at').notNull(),
})
