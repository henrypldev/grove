import {
	useQuery as useTanstackQuery,
	type UseQueryResult,
} from '@tanstack/react-query'
import { useGrove } from './provider'
import type { RouteMap, RouteParams, RouteQuery, RouteResponse } from './types'

function buildUrl(
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

type UseGroveQueryOptions<P extends keyof RouteMap> = {
	enabled?: boolean
	refetchInterval?: number
	staleTime?: number
	gcTime?: number
} & (RouteParams<P> extends undefined ? {} : { params: RouteParams<P> }) &
	(RouteQuery<P> extends undefined
		? { query?: never }
		: { query?: RouteQuery<P> })

export function useQuery<P extends keyof RouteMap>(
	path: P,
	options?: UseGroveQueryOptions<P>,
): UseQueryResult<RouteResponse<P>> {
	const { baseUrl } = useGrove()
	const params = (options as any)?.params
	const query = (options as any)?.query

	return useTanstackQuery({
		queryKey: [path, params, query].filter(Boolean),
		queryFn: async () => {
			const url = buildUrl(baseUrl, path, params, query)
			const res = await fetch(url)
			if (!res.ok) {
				const err = await res.json().catch(() => ({}))
				throw new Error((err as any).error ?? `HTTP ${res.status}`)
			}
			return res.json()
		},
		enabled: options?.enabled,
		refetchInterval: options?.refetchInterval,
		staleTime: options?.staleTime,
		gcTime: options?.gcTime,
	})
}
