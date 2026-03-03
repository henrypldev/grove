import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { GroveClient } from '../client'
import type { ConnectionStatus } from '../types'

interface GroveContextValue {
	client: GroveClient
	baseUrl: string
	status: ConnectionStatus
}

const GroveContext = createContext<GroveContextValue | null>(null)

export interface GroveProviderProps {
	url: string
	children: React.ReactNode
	autoConnect?: boolean
	deviceType?: 'mac' | 'mobile'
}

export function GroveProvider({ url, children, autoConnect = true, deviceType }: GroveProviderProps) {
	const wsUrl = useMemo(() => {
		const u = url.replace('https://', 'wss://').replace('http://', 'ws://')
		return u.endsWith('/ws') ? u : `${u}/ws`
	}, [url])

	const baseUrl = useMemo(() => {
		return url.replace(/\/ws\/?$/, '')
	}, [url])

	const clientRef = useRef<GroveClient | null>(null)
	if (!clientRef.current) {
		clientRef.current = new GroveClient({ url: wsUrl, deviceType })
	}
	const client = clientRef.current

	const [status, setStatus] = useState<ConnectionStatus>(client.status)

	useEffect(() => {
		const onConnected = () => setStatus('connected')
		const onDisconnected = () => setStatus('disconnected')
		const onReconnecting = () => setStatus('connecting')

		client.on('connected', onConnected)
		client.on('disconnected', onDisconnected)
		client.on('reconnecting', onReconnecting)

		if (autoConnect) {
			client.connect().catch(() => {})
		}

		return () => {
			client.off('connected', onConnected)
			client.off('disconnected', onDisconnected)
			client.off('reconnecting', onReconnecting)
			client.disconnect()
		}
	}, [client, autoConnect])

	const value = useMemo(() => ({ client, baseUrl, status }), [client, baseUrl, status])

	return <GroveContext.Provider value={value}>{children}</GroveContext.Provider>
}

export function useGrove(): GroveContextValue {
	const ctx = useContext(GroveContext)
	if (!ctx) throw new Error('useGrove must be used within a <GroveProvider>')
	return ctx
}
