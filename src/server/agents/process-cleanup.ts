import { log } from '../config'

/**
 * Find and kill orphaned Claude Code processes that were spawned by Grove
 * but survived a server restart.
 */
export async function cleanupOrphanedProcesses(): Promise<void> {
	try {
		// Find claude processes that might be orphaned
		const proc = Bun.spawn(['pgrep', '-f', 'claude.*bypassPermissions'], {
			stdout: 'pipe',
			stderr: 'ignore',
		})
		const text = await new Response(proc.stdout).text()
		const pids = text.trim().split('\n').filter(Boolean)

		if (pids.length === 0) {
			log('cleanup', 'no orphaned claude processes found')
			return
		}

		log('cleanup', `found ${pids.length} orphaned claude processes, killing`, {
			pids,
		})

		for (const pid of pids) {
			try {
				process.kill(Number(pid), 'SIGTERM')
			} catch {
				// Process may have already exited
			}
		}
	} catch {
		// pgrep returns exit code 1 when no matches found, which is expected
		log('cleanup', 'no orphaned claude processes found')
	}
}
