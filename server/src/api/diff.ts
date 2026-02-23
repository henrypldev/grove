export type DiffFile = {
	path: string
	status: 'added' | 'modified' | 'deleted'
	additions: number
	deletions: number
	patch: string
}

export type DiffResult = {
	files: DiffFile[]
	stat: string
}

export async function computeDiff(cwd: string): Promise<DiffResult | null> {
	let nameStatus: string
	let numstat: string
	let statOutput: string
	let diffOutput: string
	try {
		const originBase = await Bun.$`git -C ${cwd} merge-base origin/main HEAD`
			.quiet()
			.nothrow()
		const base =
			originBase.exitCode === 0
				? originBase.stdout.toString().trim()
				: (await Bun.$`git -C ${cwd} merge-base main HEAD`.text()).trim()
		;[nameStatus, numstat, statOutput, diffOutput] = await Promise.all([
			Bun.$`git -C ${cwd} diff ${base} HEAD --name-status`.text(),
			Bun.$`git -C ${cwd} diff ${base} HEAD --numstat`.text(),
			Bun.$`git -C ${cwd} diff ${base} HEAD --stat`.text(),
			Bun.$`git -C ${cwd} diff ${base} HEAD`.text(),
		])
	} catch {
		return null
	}

	const statusMap = new Map<string, 'added' | 'modified' | 'deleted'>()
	for (const line of nameStatus.trim().split('\n')) {
		if (!line) continue
		const [code, ...rest] = line.split('\t')
		const filePath = rest.join('\t')
		const status =
			code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified'
		statusMap.set(filePath, status)
	}

	const statsMap = new Map<string, { additions: number; deletions: number }>()
	for (const line of numstat.trim().split('\n')) {
		if (!line) continue
		const [add, del, ...rest] = line.split('\t')
		const filePath = rest.join('\t')
		statsMap.set(filePath, {
			additions: add === '-' ? 0 : Number(add),
			deletions: del === '-' ? 0 : Number(del),
		})
	}

	const patchMap = new Map<string, string>()
	for (const chunk of diffOutput.split('diff --git ').filter(Boolean)) {
		const headerMatch = chunk.match(/^a\/(.+?) b\/(.+)/)
		if (!headerMatch) continue
		patchMap.set(headerMatch[2], `diff --git ${chunk}`)
	}

	const files = [...statusMap.entries()].map(([path, status]) => ({
		path,
		status,
		additions: statsMap.get(path)?.additions ?? 0,
		deletions: statsMap.get(path)?.deletions ?? 0,
		patch: patchMap.get(path) ?? '',
	}))

	const statLines = statOutput.trim().split('\n')
	const stat = statLines[statLines.length - 1]?.trim() ?? ''

	return { files, stat }
}
