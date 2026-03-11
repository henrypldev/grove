import { unstable_v2_prompt } from '@anthropic-ai/claude-agent-sdk'
import { which } from 'bun'
import { log } from '../config'

interface CreatePrOptions {
	cwd: string
	task: string
	title: string | null
}

function buildPrompt(opts: CreatePrOptions, diff: string) {
	return `You are a PR description writer. Given a task and diff, produce a PR title and description.

## Context
The team was given this task: ${opts.task}
${opts.title ? `Team title: ${opts.title}` : ''}

## Diff (first 8000 chars)
\`\`\`
${diff.slice(0, 8000)}
\`\`\`

## Instructions
Write a concise PR title and a markdown description summarizing the changes.
The title should be short (under 70 chars) and reflect the actual changes, not generic text.
The description should have a brief summary of what changed and why.

Respond with EXACTLY this format and nothing else:
TITLE: <your title here>
DESCRIPTION:
<your markdown description here>`
}

function parsePromptResult(raw: string): { title: string; description: string } {
	const titleMatch = raw.match(/TITLE:\s*(.+)/)
	const descMatch = raw.match(/DESCRIPTION:\s*\n([\s\S]+)/)

	const title = titleMatch?.[1]?.trim()
	const description = descMatch?.[1]?.trim()

	if (!title) {
		throw new Error(`Failed to parse PR title from response: ${raw}`)
	}

	return { title, description: description ?? '' }
}

export async function createPr(opts: CreatePrOptions): Promise<{ prUrl: string }> {
	log('pr', 'starting PR creation', { cwd: opts.cwd, task: opts.task, title: opts.title })

	// Commit any uncommitted changes
	await Bun.$`git -C ${opts.cwd} add -A`.quiet().nothrow()
	const hasChanges =
		(await Bun.$`git -C ${opts.cwd} diff --cached --quiet`.quiet().nothrow())
			.exitCode !== 0
	log('pr', 'checked for uncommitted changes', { hasChanges })
	if (hasChanges) {
		const commitResult = await Bun.$`git -C ${opts.cwd} commit -m "chore: final changes"`.quiet().nothrow()
		log('pr', 'committed changes', { exitCode: commitResult.exitCode })
	}

	// Push the branch
	const pushResult = await Bun.$`git -C ${opts.cwd} push -u origin HEAD`.quiet().nothrow()
	log('pr', 'pushed branch', {
		exitCode: pushResult.exitCode,
		stderr: pushResult.stderr.toString().trim(),
	})

	// Get the diff for context
	const diffResult = await Bun.$`git -C ${opts.cwd} diff origin/main...HEAD`
		.quiet()
		.nothrow()
	let diff = diffResult.stdout.toString()
	if (!diff) {
		log('pr', 'no diff from origin/main...HEAD, falling back to log')
		const diffFallback =
			await Bun.$`git -C ${opts.cwd} log --oneline origin/main..HEAD`
				.quiet()
				.nothrow()
		diff = diffFallback.stdout.toString()
	}
	log('pr', 'got diff', { diffLength: diff.length })

	// Use Claude to generate title and description
	const claudePath = which('claude')
	log('pr', 'calling Claude for PR description', { claudePath, model: 'claude-haiku-4-5-20251001' })
	const result = await unstable_v2_prompt(buildPrompt(opts, diff), {
		model: 'claude-haiku-4-5-20251001',
		maxTurns: 1,
		cwd: opts.cwd,
		permissionMode: 'bypassPermissions',
		allowDangerouslySkipPermissions: true,
		allowedTools: [],
		...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
		// biome-ignore lint/suspicious/noExplicitAny: SDK options type is too strict
	} as any)

	// biome-ignore lint/suspicious/noExplicitAny: accessing SDK result internals
	const raw = ((result as any).result ?? '').trim()
	log('pr', 'Claude response', { raw })
	const { title, description } = parsePromptResult(raw)
	log('pr', 'parsed PR info', { title, descriptionLength: description.length })

	// Create the PR from the worktree directory
	log('pr', 'creating PR with gh', { cwd: opts.cwd })
	const prResult =
		await Bun.$`gh pr create --title ${title} --body ${description}`
			.cwd(opts.cwd)
			.quiet()
			.nothrow()

	const prStdout = prResult.stdout.toString().trim()
	const prStderr = prResult.stderr.toString().trim()
	log('pr', 'gh pr create result', {
		exitCode: prResult.exitCode,
		stdout: prStdout,
		stderr: prStderr,
	})

	if (prResult.exitCode !== 0) {
		throw new Error(`Failed to create PR: ${prStderr}`)
	}

	const urlMatch = prStdout.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/)
	if (!urlMatch) {
		throw new Error(`Failed to extract PR URL from: ${prStdout}`)
	}

	log('pr', 'PR created', { prUrl: urlMatch[0] })
	return { prUrl: urlMatch[0] }
}
