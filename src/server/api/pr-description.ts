import { unstable_v2_prompt } from '@anthropic-ai/claude-agent-sdk'
import { which } from 'bun'

const MAX_COMMITS = 12_000
const MAX_STAT = 12_000
const MAX_PATCH = 40_000

const PROMPT = `You are a PR description generator. Given git context (commits, stat, and diff), produce a JSON object with two fields:
- "title": a concise PR title (under 70 chars, imperative mood, no prefix like "feat:" or "fix:")
- "body": a markdown PR body with:
  - ## Summary — 1-4 bullet points describing what changed and why
  - ## Changes — a brief list of notable file/module changes
  - ## Testing — how to verify (or "N/A" if obvious)

Keep it concise. Focus on WHAT changed and WHY, not restating the diff.
Return ONLY valid JSON, no markdown fences.`

async function gitText(args: string[], cwd: string): Promise<string> {
	try {
		const proc = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' })
		const text = await new Response(proc.stdout).text()
		await proc.exited
		return text.trim()
	} catch {
		return ''
	}
}

export type PrDescriptionResult = {
	title: string
	body: string
	branch: string
	baseBranch: string
}

export async function generatePrDescription(
	cwd: string,
): Promise<PrDescriptionResult> {
	const base = await gitText(
		['git', 'merge-base', 'origin/main', 'HEAD'],
		cwd,
	)
	if (!base) {
		throw new Error('Could not determine merge-base with origin/main')
	}

	const [commits, stat, patch, branch] = await Promise.all([
		gitText(['git', 'log', `${base}..HEAD`, '--format=%h %s'], cwd),
		gitText(['git', 'diff', base, 'HEAD', '--stat'], cwd),
		gitText(['git', 'diff', base, 'HEAD'], cwd),
		gitText(['git', 'branch', '--show-current'], cwd),
	])

	const context = [
		'## Commits',
		commits.slice(0, MAX_COMMITS),
		'',
		'## Stat',
		stat.slice(0, MAX_STAT),
		'',
		'## Diff',
		patch.slice(0, MAX_PATCH),
	].join('\n')

	const claudePath = which('claude')
	const result = await unstable_v2_prompt(
		`${PROMPT}\n\n${context}`,
		{
			maxTurns: 1,
			allowedTools: [],
			...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
			// biome-ignore lint/suspicious/noExplicitAny: SDK options type is too strict
		} as any,
	)

	// biome-ignore lint/suspicious/noExplicitAny: accessing SDK result internals
	const raw = ((result as any).result ?? '').trim()
	try {
		const parsed = JSON.parse(raw)
		return {
			title: parsed.title ?? 'Update',
			body: parsed.body ?? '',
			branch: branch || 'HEAD',
			baseBranch: 'main',
		}
	} catch {
		// If the LLM didn't return valid JSON, use the raw text as body
		return {
			title: 'Update',
			body: raw,
			branch: branch || 'HEAD',
			baseBranch: 'main',
		}
	}
}
