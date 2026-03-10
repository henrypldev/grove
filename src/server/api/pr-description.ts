import { unstable_v2_prompt } from '@anthropic-ai/claude-agent-sdk'
import { which } from 'bun'

const PROMPT = `You are a PR creation agent. Your job is to push the current branch and create a pull request.

Run the /commit-commands:commit-push-pr skill to commit any uncommitted changes, push the branch, and create the PR.

After the PR is created, respond with ONLY the PR URL (e.g. https://github.com/owner/repo/pull/123). Nothing else.`

export async function createPr(cwd: string): Promise<{ prUrl: string }> {
	const claudePath = which('claude')
	const result = await unstable_v2_prompt(PROMPT, {
		model: 'claude-haiku-4-5-20251001',
		maxTurns: 30,
		cwd,
		permissionMode: 'bypassPermissions',
		allowDangerouslySkipPermissions: true,
		allowedTools: ['Bash', 'Read', 'Glob', 'Grep', 'Edit', 'Write', 'Skill'],
		...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
		// biome-ignore lint/suspicious/noExplicitAny: SDK options type is too strict
	} as any)

	// biome-ignore lint/suspicious/noExplicitAny: accessing SDK result internals
	const raw = ((result as any).result ?? '').trim()

	// Extract PR URL from the result
	const urlMatch = raw.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/)
	if (!urlMatch) {
		throw new Error(`Failed to create PR: ${raw}`)
	}

	return { prUrl: urlMatch[0] }
}
