import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useGrove } from './provider'
import type { SubscriptionEvent, SubscriptionMap } from './types'

const INVALIDATION_MAP: Record<SubscriptionEvent, string[]> = {
	'team:update': ['/v2/teams', '/v2/dashboard'],
	'agent:update': ['/v2/teams'],
	activity: ['/v2/teams'],
	log: ['/v2/teams'],
	'replay:batch': ['/v2/teams'],
}

type SubscriptionData<E extends SubscriptionEvent> = SubscriptionMap[E]['data']

interface UseQuerySubscriptionOptions {
	channel: string
	enabled?: boolean
}

interface UseQuerySubscriptionResult<E extends SubscriptionEvent> {
	data: SubscriptionData<E> | null
	history: SubscriptionData<E>[]
}

export function useQuerySubscription<E extends SubscriptionEvent>(
	event: E,
	options: UseQuerySubscriptionOptions,
): UseQuerySubscriptionResult<E> {
	const { client } = useGrove()
	const queryClient = useQueryClient()
	const { channel, enabled = true } = options

	const [data, setData] = useState<SubscriptionData<E> | null>(null)
	const historyRef = useRef<SubscriptionData<E>[]>([])
	const [history, setHistory] = useState<SubscriptionData<E>[]>([])

	const handler = useCallback(
		(eventData: any, eventChannel: string) => {
			// team:update events come on the 'global' channel
			if (eventChannel !== channel && event !== 'team:update') return

			setData(eventData)
			historyRef.current = [...historyRef.current, eventData]
			setHistory(historyRef.current)

			const paths = INVALIDATION_MAP[event]
			if (paths) {
				for (const path of paths) {
					queryClient.invalidateQueries({ queryKey: [path] })
				}
			}
		},
		[channel, event, queryClient],
	)

	useEffect(() => {
		if (!enabled) return

		client.subscribe([channel])
		client.on(event as any, handler)

		return () => {
			client.off(event as any, handler)
			client.unsubscribe([channel])
		}
	}, [client, channel, event, enabled, handler])

	return { data, history }
}
