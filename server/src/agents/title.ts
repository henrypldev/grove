import { query } from '@anthropic-ai/claude-agent-sdk'

const PROMPT = `Generate a short, specific title (3-6 words) for this development task. Focus on WHAT is being built or fixed, not how. Use lowercase. No punctuation. No filler words like "implement" or "add support for".

Examples of good titles:
- dark mode toggle
- fix login redirect loop
- onboarding flow redesign
- websocket reconnection logic`

export async function generateTeamTitle(task: string): Promise<string> {
	const fallback = task.split('\n')[0].slice(0, 60)
	try {
		for await (const message of query({
			prompt: `${PROMPT}\n\nTask: ${task}`,
			options: {
				maxTurns: 1,
				allowedTools: [],
			},
		})) {
			if (message.type === 'result' && message.subtype === 'success') {
				return message.result?.trim() || fallback
			}
		}
		return fallback
	} catch {
		return fallback
	}
}
