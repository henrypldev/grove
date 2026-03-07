import type { MigrationMeta } from 'drizzle-orm/migrator'

// Auto-generated from drizzle/ migration files.
// Run 'bun scripts/embed-migrations.ts' to regenerate after adding new migrations.
export const migrations: MigrationMeta[] = [
	{
		sql: [
			"CREATE TABLE `agents` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`team_id` text NOT NULL,\n\t`role` text NOT NULL,\n\t`status` text NOT NULL,\n\t`activity` text,\n\t`current_task` text,\n\t`session_id` text,\n\t`retry_count` integer DEFAULT 0,\n\t`spawned_at` integer NOT NULL,\n\t`updated_at` integer NOT NULL,\n\tFOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action\n);\n",
			"\nCREATE TABLE `events` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`team_id` text NOT NULL,\n\t`agent_id` text,\n\t`type` text NOT NULL,\n\t`payload` text NOT NULL,\n\t`created_at` integer NOT NULL,\n\tFOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,\n\tFOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action\n);\n",
			"\nCREATE INDEX `idx_events_team_created` ON `events` (`team_id`,`created_at`);",
			"\nCREATE INDEX `idx_events_agent_created` ON `events` (`agent_id`,`created_at`);",
			"\nCREATE TABLE `plans` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`team_id` text NOT NULL,\n\t`type` text NOT NULL,\n\t`agent_id` text NOT NULL,\n\t`content` text NOT NULL,\n\t`created_at` integer NOT NULL,\n\tFOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action\n);\n",
			"\nCREATE TABLE `pm_reports` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`team_id` text NOT NULL,\n\t`summary` text NOT NULL,\n\t`created_at` integer NOT NULL,\n\tFOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action\n);\n",
			"\nCREATE TABLE `repos` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`name` text NOT NULL,\n\t`path` text NOT NULL,\n\t`github_url` text,\n\t`env_vars` text,\n\t`setup_steps` text,\n\t`added_at` integer NOT NULL\n);\n",
			"\nCREATE TABLE `teams` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`repo_id` text NOT NULL,\n\t`worktree_path` text NOT NULL,\n\t`task` text NOT NULL,\n\t`title` text,\n\t`status` text NOT NULL,\n\t`pm_summary` text,\n\t`port` integer,\n\t`created_at` integer NOT NULL,\n\t`updated_at` integer NOT NULL,\n\tFOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE no action\n);\n",
			"\nCREATE TABLE `usage` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`team_id` text NOT NULL,\n\t`agent_id` text,\n\t`model` text NOT NULL,\n\t`input_tokens` integer NOT NULL,\n\t`output_tokens` integer NOT NULL,\n\t`cache_read_tokens` integer DEFAULT 0 NOT NULL,\n\t`cache_creation_tokens` integer DEFAULT 0 NOT NULL,\n\t`cost_usd` real NOT NULL,\n\t`duration_ms` integer NOT NULL,\n\t`duration_api_ms` integer NOT NULL,\n\t`num_turns` integer NOT NULL,\n\t`created_at` integer NOT NULL,\n\tFOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,\n\tFOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action\n);\n",
			"\nCREATE INDEX `idx_usage_created` ON `usage` (`created_at`);",
			"\nCREATE INDEX `idx_usage_team_created` ON `usage` (`team_id`,`created_at`);",
		],
		folderMillis: 1771947066054,
		hash: '557e55aea893280df223849d427970238ada4a77f4d6abb240ecb3f2adf952e0',
		bps: true,
	},
	{
		sql: [
			"ALTER TABLE `teams` ADD `pr_url` text;",
		],
		folderMillis: 1771972005947,
		hash: 'b926fcf30dbe5e7c7cbf2a25a043cccb54d70f03eed1731c971f5dd06d85600f',
		bps: true,
	},
	{
		sql: [
			"ALTER TABLE `repos` ADD `fingerprint` text;",
			"\nALTER TABLE `repos` ADD `needs_native_build` integer;",
		],
		folderMillis: 1772025336827,
		hash: 'c64631c5cb5b1c3e71802aa0d79351131938e087b9712c554f1a908633a59bbe',
		bps: true,
	},
	{
		sql: [
			"CREATE TABLE `prds` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`team_id` text NOT NULL REFERENCES `teams`(`id`),\n\t`agent_id` text NOT NULL,\n\t`content` text NOT NULL,\n\t`created_at` integer NOT NULL\n);\n",
			"\nCREATE TABLE `design_docs` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`team_id` text NOT NULL REFERENCES `teams`(`id`),\n\t`agent_id` text NOT NULL,\n\t`content` text NOT NULL,\n\t`created_at` integer NOT NULL\n);\n",
			"\nCREATE TABLE `agent_tasks` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`team_id` text NOT NULL REFERENCES `teams`(`id`),\n\t`agent_id` text REFERENCES `agents`(`id`),\n\t`id_string` text NOT NULL,\n\t`title` text NOT NULL,\n\t`priority` integer NOT NULL,\n\t`status` text DEFAULT 'pending' NOT NULL,\n\t`blocked_by` text,\n\t`created_at` integer NOT NULL\n);\n",
			"\nCREATE TABLE `agent_notes` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`team_id` text NOT NULL REFERENCES `teams`(`id`),\n\t`agent_id` text NOT NULL,\n\t`content` text NOT NULL,\n\t`created_at` integer NOT NULL\n);\n",
			"\nDROP TABLE `plans`;\n",
		],
		folderMillis: 1772092800000,
		hash: '7fb14a6163e60f410a7fa3a180766a696f8fb8b0fe0b402ffd297de2b88ecaa5',
		bps: true,
	},
	{
		sql: [
			"CREATE TABLE `team_dependencies` (\n\t`team_id` text NOT NULL,\n\t`depends_on_team_id` text NOT NULL,\n\tFOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,\n\tFOREIGN KEY (`depends_on_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action\n);\n",
			"\nCREATE INDEX `idx_team_deps_team` ON `team_dependencies` (`team_id`);",
		],
		folderMillis: 1772135754989,
		hash: '11844bdf9c84f5a11afc434969e9c26f808a93a0ad7785102c425b73fd6ef16c',
		bps: true,
	},
	{
		sql: [
			"CREATE TABLE `scripts` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`repo_id` text NOT NULL,\n\t`name` text NOT NULL,\n\t`run` text NOT NULL,\n\t`background` integer,\n\t`created_at` integer NOT NULL,\n\tFOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE no action\n);\n",
		],
		folderMillis: 1772203544102,
		hash: '1cd48039190709221bd2df33a3d8f75fad1cbbfdc85422f82bd8e4c9ae00f353',
		bps: true,
	},
	{
		sql: [
			"ALTER TABLE `repos` ADD `framework` text;",
			"\nALTER TABLE `teams` DROP COLUMN `port`;",
		],
		folderMillis: 1772211494203,
		hash: '8a73107febdb565d5c35dfb3b785655885cddb820e15bc6811c5117ef2f16bfa',
		bps: true,
	},
	{
		sql: [
			"CREATE TABLE `logs` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`team_id` text NOT NULL,\n\t`type` text NOT NULL,\n\t`payload` text NOT NULL,\n\t`created_at` integer NOT NULL,\n\tFOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action\n);\n",
			"\nCREATE INDEX `idx_logs_team_created` ON `logs` (`team_id`,`created_at`);",
		],
		folderMillis: 1772300000000,
		hash: '3d3643b162b2e8200c749760059c6162e2fd195d330f01300a47b932df74931f',
		bps: true,
	},
	{
		sql: [
			"ALTER TABLE `events` RENAME TO `activity`;\n",
			"\nDROP INDEX IF EXISTS `idx_events_team_created`;\n",
			"\nDROP INDEX IF EXISTS `idx_events_agent_created`;\n",
			"\nCREATE INDEX `idx_activity_team_created` ON `activity` (`team_id`,`created_at`);\n",
			"\nCREATE INDEX `idx_activity_agent_created` ON `activity` (`agent_id`,`created_at`);\n",
		],
		folderMillis: 1772400000000,
		hash: '7292e3873cc31a61626ad48d22d78e87714f1e484ec179506604be4d49fcb0dd',
		bps: true,
	},
	{
		sql: [
			"DROP TABLE `logs`;",
		],
		folderMillis: 1772500000000,
		hash: '9aa4677c55aa65fd82bfb19e9b99f68045930d56f03979501cb23a6890bdd69b',
		bps: true,
	},
	{
		sql: [
			"CREATE INDEX `idx_agent_notes_team` ON `agent_notes` (`team_id`);",
			"\nCREATE INDEX `idx_agent_tasks_team` ON `agent_tasks` (`team_id`);",
			"\nCREATE INDEX `idx_agents_team` ON `agents` (`team_id`);",
			"\nCREATE INDEX `idx_design_docs_team` ON `design_docs` (`team_id`);",
			"\nCREATE INDEX `idx_prds_team` ON `prds` (`team_id`);",
			"\nCREATE INDEX `idx_teams_repo` ON `teams` (`repo_id`);",
		],
		folderMillis: 1772664136095,
		hash: '3c16e788bfc0aaf3486933e309955306f8e69e5048c1699e0afc7196e7e0f2fe',
		bps: true,
	},
	{
		sql: [
			"ALTER TABLE `agents` ADD COLUMN `task_id` text;",
		],
		folderMillis: 1772750000000,
		hash: '6218d8be51ec6d143f437e26308f8bad75b3e1cac97c73379db0ad5ad8b67f21',
		bps: true,
	},
]
