import { checkFingerprintAndRebuild } from '../api/expo-build'
import { dbGetRepo } from '../db/repos'
import type { Team } from '../types'

const installPattern =
	/\b(npm install|yarn add|pnpm add|bun add|bun install|expo install)\b/

export function makeOnPostBash(
	team: Team,
): ((command: string) => void) | undefined {
	const repo = dbGetRepo(team.repoId)
	if (!repo?.needsNativeBuild) return undefined

	return (command: string) => {
		if (installPattern.test(command)) {
			checkFingerprintAndRebuild(team.id, team.worktreePath, team.repoId)
		}
	}
}
