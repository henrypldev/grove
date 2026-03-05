import { unstable_v2_prompt } from '@anthropic-ai/claude-agent-sdk'
import { which } from 'bun'

const PROMPT = `Generate a short, specific title (3-6 words) for this development task. Focus on WHAT is being built or fixed, not how. Use lowercase. No punctuation. No filler words like "implement" or "add support for".

Examples of good titles:
- dark mode toggle
- fix login redirect loop
- onboarding flow redesign
- websocket reconnection logic`

export async function generateTeamTitle(task: string): Promise<string> {
	const fallback = task.split('\n')[0].slice(0, 60)
	try {
		const claudePath = which('claude')
		const result = await unstable_v2_prompt(`${PROMPT}\n\nTask: ${task}`, {
			maxTurns: 1,
			allowedTools: [],
			...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
		} as any)
		return (result as any).result?.trim() || fallback
	} catch {
		return fallback
	}
}
