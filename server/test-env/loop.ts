import { query } from '@anthropic-ai/claude-agent-sdk'
import path from 'path'

const serverDir = path.resolve(import.meta.dir, '..')

async function runTests(): Promise<{ passed: boolean; output: string }> {
	const proc = Bun.spawn(['bun', 'test', 'test-env/'], {
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

console.log('Starting agent loop...\n')

let iteration = 0
const maxIterations = 5

for await (const message of query({
	prompt: `You are an engineering orchestrator. Your goal is to make all tests in \`test-env/\` pass.

Failing tests:
${initial.output}

Source files to fix (do NOT modify *.test.ts files):
- test-env/buggy/stats.ts
- test-env/buggy/cache.ts
- test-env/buggy/queue.ts
- test-env/buggy/client.ts
- test-env/feature/rate-limiter.ts

Use the Task tool to delegate work through this hierarchy:
1. Spawn a PM agent — reads all failing tests and source files, produces a fix plan per file
2. PM spawns a Team Lead — assigns one developer agent per file to implement the fixes
3. Each developer agent fixes exactly one file based on the plan
4. Team Lead spawns a Reviewer agent — reads diffs and confirms correctness
5. Team Lead spawns a QA agent — runs \`bun test test-env/\` and reports results

Working directory: ${serverDir}`,
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

							console.log(`\nIteration ${iteration}/${maxIterations} — tests still failing, continuing...\n`)
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
	switch (message.type) {
		case 'assistant':
			for (const block of message.message.content) {
				if (block.type === 'text') process.stdout.write(block.text)
				else if (block.type === 'tool_use') console.log(`\n[tool] ${block.name}`)
			}
			break
		case 'result':
			console.log(`\n[result] subtype=${message.subtype}`)
			break
		case 'system':
			console.log(`[system] subtype=${message.subtype}`)
			break
		default:
			console.log(`[${message.type}]`)
	}
}
