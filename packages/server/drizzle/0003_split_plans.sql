CREATE TABLE `prds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` text NOT NULL REFERENCES `teams`(`id`),
	`agent_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `design_docs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` text NOT NULL REFERENCES `teams`(`id`),
	`agent_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` text NOT NULL REFERENCES `teams`(`id`),
	`agent_id` text REFERENCES `agents`(`id`),
	`id_string` text NOT NULL,
	`title` text NOT NULL,
	`priority` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`blocked_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` text NOT NULL REFERENCES `teams`(`id`),
	`agent_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
DROP TABLE `plans`;
