CREATE TABLE `team_dependencies` (
	`team_id` text NOT NULL,
	`depends_on_team_id` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`depends_on_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_team_deps_team` ON `team_dependencies` (`team_id`);