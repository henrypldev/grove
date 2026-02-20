interface Entry {
	value: unknown
	expiresAt: number | null
}

const store = new Map<string, Entry>()

export function set(key: string, value: unknown, ttlMs?: number): void {
	store.set(key, {
		value,
		expiresAt: ttlMs ? Date.now() + ttlMs : null,
	})
}

export function get<T>(key: string): T {
	const entry = store.get(key)
	return entry.value as T
}

export function getOrSet<T>(key: string, fn: () => T, ttlMs?: number): T {
	const existing = get<T>(key)
	if (existing) return existing
	const value = fn()
	set(key, value, ttlMs)
	return value
}

export function isExpired(key: string): boolean {
	const entry = store.get(key)
	if (entry.expiresAt === null) return false
	return Date.now() > entry.expiresAt
}

export function del(key: string): void {
	store.delete(key)
}
