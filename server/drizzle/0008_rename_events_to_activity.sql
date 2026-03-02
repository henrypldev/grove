ALTER TABLE `events` RENAME TO `activity`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_events_team_created`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_events_agent_created`;
--> statement-breakpoint
CREATE INDEX `idx_activity_team_created` ON `activity` (`team_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_activity_agent_created` ON `activity` (`agent_id`,`created_at`);
