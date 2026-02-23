CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`activity` text,
	`current_task` text,
	`session_id` text,
	`retry_count` integer DEFAULT 0,
	`spawned_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` text NOT NULL,
	`agent_id` text,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_events_team_created` ON `events` (`team_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_events_agent_created` ON `events` (`agent_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` text NOT NULL,
	`type` text NOT NULL,
	`agent_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pm_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `repos` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`github_url` text,
	`env_vars` text,
	`setup_steps` text,
	`added_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`worktree_path` text NOT NULL,
	`task` text NOT NULL,
	`title` text,
	`status` text NOT NULL,
	`pm_summary` text,
	`port` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE no action
);
