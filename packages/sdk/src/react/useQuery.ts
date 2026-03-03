import {
	useQuery as useTanstackQuery,
	type UseQueryResult,
} from '@tanstack/react-query'
import { buildUrl, fetchJson } from './fetch'
import { useGrove } from './provider'
import type { RouteMap, RouteParams, RouteQuery, RouteResponse } from './types'

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
		queryKey: [path, params ?? null, query ?? null],
		queryFn: () => fetchJson<RouteResponse<P>>(buildUrl(baseUrl, path, params, query)),
		enabled: options?.enabled,
		refetchInterval: options?.refetchInterval,
		staleTime: options?.staleTime,
		gcTime: options?.gcTime,
	})
}
