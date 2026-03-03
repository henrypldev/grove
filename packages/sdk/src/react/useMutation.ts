import {
	useMutation as useTanstackMutation,
	type UseMutationResult,
} from '@tanstack/react-query'
import { buildUrl, fetchJson } from './fetch'
import { useGrove } from './provider'
import type { MutationBody, MutationKey, MutationParams, MutationResponse } from './types'

function parseMutationKey(key: string): { method: string; path: string } {
	const spaceIdx = key.indexOf(' ')
	return {
		method: key.slice(0, spaceIdx),
		path: key.slice(spaceIdx + 1),
	}
}

type MutationVariables<K extends MutationKey> =
	(MutationParams<K> extends undefined ? {} : { params: MutationParams<K> }) &
	(MutationBody<K> extends undefined ? {} : { body: MutationBody<K> })

function hasFiles(body: unknown): boolean {
	if (!body || typeof body !== 'object') return false
	return Object.values(body as Record<string, unknown>).some(
		(v) => v instanceof File || (Array.isArray(v) && v.some((item) => item instanceof File)),
	)
}

function toFormData(body: Record<string, unknown>): FormData {
	const fd = new FormData()
	for (const [key, value] of Object.entries(body)) {
		if (value === undefined || value === null) continue
		if (Array.isArray(value)) {
			for (const item of value) {
				fd.append(key, item instanceof File ? item : String(item))
			}
		} else if (value instanceof File) {
			fd.append(key, value)
		} else if (typeof value === 'object') {
			fd.append(key, JSON.stringify(value))
		} else {
			fd.append(key, String(value))
		}
	}
	return fd
}

export function useMutation<K extends MutationKey>(
	key: K,
	options?: {
		onSuccess?: (data: MutationResponse<K>) => void
		onError?: (error: Error) => void
	},
): UseMutationResult<MutationResponse<K>, Error, MutationVariables<K>> {
	const { baseUrl } = useGrove()
	const { method, path } = parseMutationKey(key)

	return useTanstackMutation({
		mutationFn: async (variables: MutationVariables<K>) => {
			const params = (variables as any)?.params
			const body = (variables as any)?.body
			const url = buildUrl(baseUrl, path, params)

			const init: RequestInit = { method }

			if (body !== undefined) {
				if (hasFiles(body)) {
					init.body = toFormData(body as Record<string, unknown>)
				} else {
					init.headers = { 'Content-Type': 'application/json' }
					init.body = JSON.stringify(body)
				}
			}

			return fetchJson<MutationResponse<K>>(url, init)
		},
		onSuccess: options?.onSuccess as any,
		onError: options?.onError,
	})
}
