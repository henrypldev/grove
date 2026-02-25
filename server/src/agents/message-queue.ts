export type QueueItem =
	| { type: 'text'; text: string }
	| { type: 'content'; content: unknown[] }

export class MessageQueue {
	private buffer: QueueItem[] = []
	private resolve: ((value: QueueItem | null) => void) | null = null
	private closed = false

	push(text: string) {
		const item: QueueItem = { type: 'text', text }
		if (this.resolve) {
			const r = this.resolve
			this.resolve = null
			r(item)
		} else {
			this.buffer.push(item)
		}
	}

	pushContent(content: unknown[]) {
		const item: QueueItem = { type: 'content', content }
		if (this.resolve) {
			const r = this.resolve
			this.resolve = null
			r(item)
		} else {
			this.buffer.push(item)
		}
	}

	dequeue(): Promise<QueueItem | null> {
		if (this.buffer.length > 0) {
			return Promise.resolve(this.buffer.shift()!)
		}
		if (this.closed) {
			return Promise.resolve(null)
		}
		return new Promise(r => {
			this.resolve = r
		})
	}

	close() {
		this.closed = true
		if (this.resolve) {
			const r = this.resolve
			this.resolve = null
			r(null)
		}
	}
}
