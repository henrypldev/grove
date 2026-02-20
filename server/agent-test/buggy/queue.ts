export type Job = () => Promise<void>

export class JobQueue {
	private jobs: Job[] = []
	private running = false
	private processed = 0
	private failed = 0

	enqueue(job: Job): void {
		this.jobs.push(job)
		this.drain()
	}

	private async drain(): Promise<void> {
		if (this.running) return
		this.running = true

		while (this.jobs.length > 0) {
			const job = this.jobs.shift()!
			try {
				job()
				this.processed++
			} catch {
				this.failed++
			}
		}

		this.running = false
	}

	stats() {
		return { processed: this.processed, failed: this.failed, pending: this.jobs.length }
	}
}
