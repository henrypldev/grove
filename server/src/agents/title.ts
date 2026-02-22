export async function generateTeamTitle(task: string): Promise<string> {
	const fallback = task.split('\n')[0].slice(0, 60)
	try {
		const apiKey = Bun.env.ANTHROPIC_API_KEY
		if (!apiKey) return fallback
		const res = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'x-api-key': apiKey,
				'anthropic-version': '2023-06-01',
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				model: 'claude-haiku-4-5-20251001',
				max_tokens: 32,
				messages: [
					{
						role: 'user',
						content: `Summarize the following task in 6-8 words as a short title. Reply with only the title, no punctuation.\n\nTask: ${task}`,
					},
				],
			}),
		})
		if (!res.ok) return fallback
		const json = (await res.json()) as {
			content: Array<{ type: string; text: string }>
		}
		return json.content[0]?.text?.trim() || fallback
	} catch {
		return fallback
	}
}
