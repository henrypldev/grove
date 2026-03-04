CREATE INDEX `idx_agent_notes_team` ON `agent_notes` (`team_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_tasks_team` ON `agent_tasks` (`team_id`);--> statement-breakpoint
CREATE INDEX `idx_agents_team` ON `agents` (`team_id`);--> statement-breakpoint
CREATE INDEX `idx_design_docs_team` ON `design_docs` (`team_id`);--> statement-breakpoint
CREATE INDEX `idx_prds_team` ON `prds` (`team_id`);--> statement-breakpoint
CREATE INDEX `idx_teams_repo` ON `teams` (`repo_id`);