export interface Task {
	id: string
	status: 'todo' | 'in_progress' | 'done'
	priority: number
	createdAt: number
	completedAt: number | null
}

export function getActiveTaskCount(tasks: Task[]): number {
	return tasks.filter(t => t.status !== 'todo').length
}

export function averageCompletionTime(tasks: Task[]): number {
	const completed = tasks.filter(t => t.completedAt !== null)
	const total = completed.reduce((sum, t) => sum + (t.completedAt! - t.createdAt), 0)
	return total / tasks.length
}

export function topPriorityTask(tasks: Task[]): Task | null {
	if (tasks.length === 0) return null
	return tasks.reduce((best, t) => (t.priority > best.priority ? t : best))
}

export function tasksDueForReview(tasks: Task[], afterMs: number): Task[] {
	const cutoff = Date.now() - afterMs
	return tasks.filter(t => t.status === 'in_progress' && t.createdAt > cutoff)
}
