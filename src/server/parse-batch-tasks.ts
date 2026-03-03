export interface ParsedTask {
	task: string
	dependsOn: number[]
}

export interface ParsedBatch {
	context: string
	tasks: ParsedTask[]
}

const DEP_PATTERN = /\[(\d+(?:,\d+)*)\]\s*$/

export function parseBatchTasks(input: string): ParsedBatch | null {
	const lines = input.split('\n')
	const contextLines: string[] = []
	const tasks: ParsedTask[] = []
	let currentTaskLines: string[] | null = null

	function flushTask() {
		if (!currentTaskLines) return
		const firstLine = currentTaskLines[0]
		const rest = currentTaskLines.slice(1)
		const depMatch = firstLine.match(DEP_PATTERN)
		const dependsOn = depMatch ? depMatch[1].split(',').map(Number) : []
		const cleanFirst = depMatch
			? firstLine.slice(0, depMatch.index).trimEnd()
			: firstLine
		const task = [cleanFirst, ...rest].join('\n').trim()
		tasks.push({ task, dependsOn })
		currentTaskLines = null
	}

	for (const line of lines) {
		if (line.startsWith('~')) {
			flushTask()
			currentTaskLines = [line.slice(1).trimStart()]
		} else if (currentTaskLines !== null) {
			if (line.trim() === '') {
				flushTask()
			} else {
				currentTaskLines.push(line)
			}
		} else {
			contextLines.push(line)
		}
	}
	flushTask()

	if (tasks.length === 0) return null

	const context = contextLines.join('\n').trim()
	return { context, tasks }
}
