/** Build a URL from a path template, params, and query string */
export function buildUrl(
	baseUrl: string,
	path: string,
	params?: Record<string, string>,
	query?: Record<string, unknown>,
): string {
	let url = `${baseUrl}${path}`
	if (params) {
		for (const [key, value] of Object.entries(params)) {
			url = url.replace(`:${key}`, encodeURIComponent(value))
		}
	}
	if (query) {
		const searchParams = new URLSearchParams()
		for (const [key, value] of Object.entries(query)) {
			if (value !== undefined && value !== null) {
				searchParams.set(key, String(value))
			}
		}
		const qs = searchParams.toString()
		if (qs) url += `?${qs}`
	}
	return url
}

/** Fetch JSON with error handling. Throws on non-ok responses. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
	const res = await fetch(url, init)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error((err as any).error ?? `HTTP ${res.status}`)
	}
	const text = await res.text()
	return text ? JSON.parse(text) : undefined
}
