import { unstable_v2_prompt } from '@anthropic-ai/claude-agent-sdk'
import { generateId, log } from '../config'
import {
	dbUpdateRepoEnvVars,
	dbUpdateRepoFingerprint,
	dbUpdateRepoFramework,
	dbUpdateRepoSetupSteps,
} from '../db/repos'
import { dbInsertScript } from '../db/scripts'
import type { EnvVar, SetupStep } from '../types'

const SETUP_DETECTOR_PROMPT = (
	repoPath: string,
) => `You are a setup detector. Your ONLY job is to figure out how to install dependencies and run the dev server for the project at: ${repoPath}

Do these steps exactly:

1. Read package.json to find the "scripts" field
2. Check which lockfile exists to detect the package manager:
   - bun.lock or bun.lockb → bun
   - yarn.lock → yarn
   - pnpm-lock.yaml → pnpm
   - package-lock.json → npm
3. Determine the install command: "{pm} install"
4. Determine the dev/start command from package.json scripts:
   - Prefer "dev" script if it exists
   - Fall back to "start" script
   - Use "{pm} run {script}" format
   - If the script itself contains a port flag (like --port), replace the port value with {{PORT}}
   - If no port flag exists, append "--port {{PORT}}" for known frameworks (expo, next, vite)
5. For Expo/React Native projects (expo in dependencies):
   - Run: npx @expo/fingerprint --json
   - Extract the hash from the output
   - Check if ios/ and android/ directories exist
6. Extract useful on-demand scripts from package.json:
   - Look at all scripts in package.json
   - Pick ones useful to run on-demand: test, build, lint, typecheck, migrate, seed, format, etc.
   - Skip dev/start scripts (those are already setup steps)
   - Use "{pm} run {script}" format for each
7. Detect environment variables:
   - Look for .env* files (e.g., .env, .env.local, .env.example) in the project root
   - If .env* files exist: parse them for KEY=VALUE pairs. For each, record { "key": "KEY", "value": "VALUE", "filePath": ".env" }
   - If NO .env* files exist: search source files (*.ts, *.tsx, *.js, *.jsx) for process.env.VARIABLE_NAME references. For each unique variable found, record { "key": "VARIABLE_NAME", "value": "", "filePath": "" }
   - Skip common built-in vars: NODE_ENV, PORT, HOME, PATH, CI
8. Detect the framework:
   - Identify the primary framework from package.json dependencies (e.g., "next", "expo", "vite", "remix", "nuxt", "astro", "sveltekit", "express", "fastify", "hono", "react-native", etc.)
   - Use the most specific framework name (e.g., "next" not "react")
   - If no recognizable framework, use null
9. Output ONLY a JSON object in this exact format (no other text):

{
  "steps": [
    { "name": "Install dependencies", "run": "bun install" },
    { "name": "Start dev server", "run": "bun run dev --port {{PORT}}", "background": true }
  ],
  "scripts": [],
  "envVars": [
    { "key": "DATABASE_URL", "value": "postgres://...", "filePath": ".env" }
  ],
  "framework": "next",
  "fingerprint": "abc123...",
  "needsNativeBuild": false
}

Rules:
- "steps" is required, always an array of SetupStep objects
- "scripts" is optional, array of { name, run } objects for on-demand scripts. Omit if none found.
- "envVars" is optional, array of { key, value, filePath } objects. Omit if no env vars found.
- "framework" is optional, the primary framework name as a lowercase string (e.g., "next", "expo", "vite"). Omit if none detected.
- "fingerprint" is optional, only for Expo/RN projects (string or null)
- "needsNativeBuild" is optional, true if Expo project is missing ios/ or android/ directories
- The dev server step MUST have "background": true
- The dev server step MUST use {{PORT}} for port assignment
- If needsNativeBuild is true (Expo project missing ios/ or android/), do NOT include the dev server step — only include the install step. The native build process handles the dev server.
- Output ONLY the JSON object, nothing else
`

export interface DetectionResult {
	steps: SetupStep[]
	scripts?: { name: string; run: string }[]
	envVars?: EnvVar[]
	framework?: string | null
	fingerprint?: string | null
	needsNativeBuild?: boolean
}

export async function detectSetupSteps(
	repoId: string,
	repoPath: string,
): Promise<DetectionResult | null> {
	log('setup-detector', 'starting detection', { repoId, repoPath })
	try {
		const result = await unstable_v2_prompt(SETUP_DETECTOR_PROMPT(repoPath), {
			model: 'claude-sonnet-4-6',
			permissionMode: 'bypassPermissions',
			allowedTools: ['Read', 'Glob', 'Bash'],
			disallowedTools: ['Edit', 'Write', 'Task', 'WebFetch', 'WebSearch'],
		})

		const text =
			typeof (result as any).result === 'string' ? (result as any).result : ''
		const jsonMatch = text.match(/\{[\s\S]*\}/)
		if (!jsonMatch) {
			log('setup-detector', 'no JSON found in result', { repoId, text })
			return null
		}

		const parsed: DetectionResult = JSON.parse(jsonMatch[0])
		if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
			log('setup-detector', 'no steps in result', { repoId })
			return null
		}

		dbUpdateRepoSetupSteps(repoId, parsed.steps)
		if (parsed.scripts && parsed.scripts.length > 0) {
			for (const s of parsed.scripts) {
				dbInsertScript({
					id: generateId(),
					repoId,
					name: s.name,
					run: s.run,
					createdAt: Date.now(),
				})
			}
		}
		if (parsed.envVars && parsed.envVars.length > 0) {
			dbUpdateRepoEnvVars(repoId, parsed.envVars)
		}
		if (parsed.framework) {
			dbUpdateRepoFramework(repoId, parsed.framework)
		}
		if (parsed.fingerprint) {
			dbUpdateRepoFingerprint(
				repoId,
				parsed.fingerprint,
				parsed.needsNativeBuild ?? false,
			)
		}
		log('setup-detector', 'detection complete', {
			repoId,
			stepCount: parsed.steps.length,
			fingerprint: parsed.fingerprint ?? null,
		})

		return parsed
	} catch (err) {
		log('setup-detector', 'detection failed', { repoId, err })
		return null
	}
}
