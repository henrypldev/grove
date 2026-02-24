import path from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'

const serverDir = path.resolve(import.meta.dir, '..')
const projectRoot = path.resolve(serverDir, '..')

async function resetTestEnv() {
	const proc = Bun.spawn(
		[
			'git',
			'restore',
			'server/agent-test/buggy/',
			'server/agent-test/feature/',
		],
		{ cwd: projectRoot, stdout: 'inherit', stderr: 'inherit' },
	)
	await proc.exited
	console.log('[reset] agent-test source files restored')
}

async function runTests(): Promise<{ passed: boolean; output: string }> {
	const proc = Bun.spawn(['bun', 'test', 'agent-test/'], {
		cwd: serverDir,
		stdout: 'pipe',
		stderr: 'pipe',
	})
	const [out, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	])
	return { passed: code === 0, output: (out + err).trim() }
}

const initial = await runTests()

if (initial.passed) {
	console.log('Tests already passing.')
	process.exit(0)
}

const prompt = `You are an engineering orchestrator. Your goal is to make all tests in \`agent-test/\` pass.

Failing tests:
${initial.output}

Source files to fix (do NOT modify *.test.ts files):
- agent-test/buggy/stats.ts
- agent-test/buggy/cache.ts
- agent-test/buggy/queue.ts
- agent-test/buggy/client.ts
- agent-test/feature/rate-limiter.ts

Use the Task tool to delegate work through this hierarchy:
1. Spawn a PM agent — reads all failing tests and source files, produces a fix plan per file
2. PM spawns a Team Lead — assigns one developer agent per file to implement the fixes
3. Each developer agent fixes exactly one file based on the plan
4. Team Lead spawns a Reviewer agent — reads diffs and confirms correctness
5. Team Lead spawns a QA agent — runs \`bun test agent-test/\` and reports results

Working directory: ${serverDir}`

const roles = [
	'Orchestrator',
	'PM',
	'Team Lead',
	'Dev-1',
	'Dev-2',
	'Dev-3',
	'Reviewer',
	'QA',
]
const sessionNames = new Map<string, string>()

function nameFor(sessionId: string): string {
	if (!sessionNames.has(sessionId)) {
		const name = roles[sessionNames.size] ?? `Agent-${sessionNames.size + 1}`
		sessionNames.set(sessionId, name)
	}
	return sessionNames.get(sessionId)!
}

function say(sessionId: string, text: string) {
	const name = nameFor(sessionId)
	const lines = text.trim().split('\n')
	console.log(`\n[${name}] ${lines[0]}`)
	for (const line of lines.slice(1))
		console.log(`${''.padEnd(name.length + 3)}${line}`)
}

console.log('Starting agent loop...\n')
console.log('[prompt]', prompt, '\n')

let iteration = 0
const maxIterations = 5

try {
	for await (const message of query({
		prompt,
		options: {
			cwd: serverDir,
			permissionMode: 'bypassPermissions',
			maxBudgetUsd: 20,
			hooks: {
				Stop: [
					{
						hooks: [
							async () => {
								iteration++
								if (iteration >= maxIterations) {
									console.log(`\nMax iterations (${maxIterations}) reached.`)
									return { continue: false }
								}

								const result = await runTests()

								if (result.passed) {
									console.log('\nAll tests passing!')
									return { continue: false }
								}

								console.log(
									`\nIteration ${iteration}/${maxIterations} — tests still failing, continuing...\n`,
								)
								return {
									continue: true,
									systemMessage: `Tests still failing (iteration ${iteration}/${maxIterations}):\n\n${result.output}\n\nContinue fixing the source files.`,
								}
							},
						],
					},
				],
			},
		},
	})) {
		if (message.type === 'assistant') {
			for (const block of message.message.content) {
				if (block.type === 'text' && block.text.trim()) {
					say(message.session_id, block.text)
				}
			}
		}
	}
} finally {
	await resetTestEnv()
}
