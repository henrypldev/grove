import { join } from 'node:path'
import { detectEnvVars } from '../api/worktrees'
import { log } from '../config'
import { dbUpdateRepoEnvVars, dbUpdateRepoFramework } from '../db/repos'
import type { EnvVar } from '../types'

const FRAMEWORKS: [string, string][] = [
	['next', 'next'],
	['expo', 'expo'],
	['nuxt', 'nuxt'],
	['@remix-run/react', 'remix'],
	['@sveltejs/kit', 'sveltekit'],
	['astro', 'astro'],
	['vite', 'vite'],
	['fastify', 'fastify'],
	['hono', 'hono'],
	['express', 'express'],
]

function detectFramework(
	deps: Record<string, string>,
	devDeps: Record<string, string>,
): string | null {
	for (const [pkg, name] of FRAMEWORKS) {
		if (pkg in deps || pkg in devDeps) return name
	}
	return null
}

export interface DetectionResult {
	envVars: EnvVar[]
	framework?: string | null
}

export async function detectRepo(
	repoId: string,
	repoPath: string,
): Promise<DetectionResult | null> {
	log('setup-detector', 'starting detection', { repoId, repoPath })
	try {
		const [envVars, framework] = await Promise.all([
			detectEnvVars(repoPath),
			readFramework(repoPath),
		])

		if (envVars.length > 0) {
			dbUpdateRepoEnvVars(repoId, envVars)
		}
		if (framework) {
			dbUpdateRepoFramework(repoId, framework)
		}

		log('setup-detector', 'detection complete', { repoId, framework })
		return { envVars, framework }
	} catch (err) {
		log('setup-detector', 'detection failed', { repoId, err })
		return null
	}
}

export async function readFramework(repoPath: string): Promise<string | null> {
	try {
		const pkg = await Bun.file(join(repoPath, 'package.json')).json()
		return detectFramework(pkg.dependencies ?? {}, pkg.devDependencies ?? {})
	} catch {
		return null
	}
}
