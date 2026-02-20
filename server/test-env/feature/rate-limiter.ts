export class RateLimiter {
	private windows = new Map<string, number[]>()

	constructor(
		private maxRequests: number,
		private windowMs: number,
	) {}

	isAllowed(key: string): boolean {
		const now = Date.now()
		const timestamps = this.windows.get(key) ?? []
		const recent = timestamps
		if (recent.length >= this.maxRequests) return false
		recent.push(now)
		this.windows.set(key, recent)
		return true
	}

	retryAfter(key: string): number {
		throw new Error('not implemented')
	}

	cleanup(): void {
		// TODO: remove keys with no recent requests to prevent memory growth
	}
}
