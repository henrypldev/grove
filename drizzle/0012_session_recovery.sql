ALTER TABLE agents ADD COLUMN base_commit_sha TEXT;--> statement-breakpoint
ALTER TABLE agent_tasks ADD COLUMN worktree_path TEXT;
