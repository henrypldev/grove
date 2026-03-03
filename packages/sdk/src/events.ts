export class TypedEmitter<
	EventMap extends { [K in keyof EventMap]: (...args: any[]) => void },
> {
	private listeners = new Map<keyof EventMap, Set<(...args: any[]) => void>>()

	on<K extends keyof EventMap>(event: K, listener: EventMap[K]): () => void {
		if (!this.listeners.has(event)) {
			this.listeners.set(event, new Set())
		}
		this.listeners.get(event)!.add(listener as any)
		return () => {
			this.listeners.get(event)?.delete(listener as any)
		}
	}

	protected emit<K extends keyof EventMap>(
		event: K,
		...args: Parameters<EventMap[K]>
	): void {
		const set = this.listeners.get(event)
		if (!set) return
		for (const listener of set) {
			;(listener as any)(...args)
		}
	}

	off<K extends keyof EventMap>(event: K, listener: EventMap[K]): void {
		this.listeners.get(event)?.delete(listener as any)
	}

	removeAllListeners(event?: keyof EventMap): void {
		if (event) {
			this.listeners.delete(event)
		} else {
			this.listeners.clear()
		}
	}
}
