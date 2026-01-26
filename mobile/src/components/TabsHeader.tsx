import { GlassView } from 'expo-glass-effect'
import { Link, usePathname } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import {
	api,
	getServerUrl,
	type Session,
	subscribeToConnection,
	subscribeToEvents,
} from '@/services/api'

function extractDomain(url: string): string {
	return url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
}

export function TabsHeader() {
	const [sessions, setSessions] = useState<Session[]>([])
	const [connected, setConnected] = useState(false)
	const [serverUrl, setServerUrl] = useState<string | null>(null)
	const pathname = usePathname()

	const loadData = useCallback(async () => {
		const url = await getServerUrl()
		if (!url) return
		setServerUrl(url)
		try {
			const data = await api.getSessions()
			setSessions(data)
			setConnected(true)
		} catch {
			setConnected(false)
		}
	}, [])

	useEffect(() => {
		loadData()
		const unsubscribeEvents = subscribeToEvents(setSessions)
		const unsubscribeConnection = subscribeToConnection(state => {
			setConnected(state.connected)
			if (state.url) setServerUrl(state.url)
		})
		return () => {
			unsubscribeEvents()
			unsubscribeConnection()
		}
	}, [loadData])

	const activeCount = sessions.filter(s => s.isActive).length

	const getFabLink = useMemo(() => {
		if (pathname === '/') {
			return '/new-session'
		} else if (pathname === '/repos') {
			return '/add-repo'
		}
		return null
	}, [pathname])

	return (
		<View style={styles.container}>
			<View style={styles.header}>
				<Text style={styles.headerTitle}>
					{serverUrl ? extractDomain(serverUrl) : 'Klaude'}
				</Text>
				<Text style={styles.headerSubtitle}>
					<Text
						style={
							connected ? styles.statusConnected : styles.statusDisconnected
						}
					>
						{connected ? 'Connected' : 'Disconnected'}
					</Text>
					{' · '}
					{activeCount} active
				</Text>
			</View>
			{getFabLink && (
				<Link href={getFabLink} asChild>
					<Pressable style={styles.fab} hitSlop={44}>
						<GlassView style={styles.fabGlass}>
							<Text style={styles.fabText}>+</Text>
						</GlassView>
					</Pressable>
				</Link>
			)}
		</View>
	)
}

const styles = StyleSheet.create((theme, rt) => ({
	container: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		paddingTop: rt.insets.top + 4,
		paddingHorizontal: theme.spacing(4),
		paddingBottom: theme.spacing(2),
	},
	header: {
		backgroundColor: theme.colors.background,
	},
	headerTitle: {
		color: theme.colors.text,
		fontSize: 20,
		fontWeight: '700',
	},
	headerSubtitle: {
		color: theme.colors.textSecondary,
		fontSize: 15,
		marginTop: theme.spacing(1),
	},
	statusConnected: {
		color: '#34C759',
	},
	statusDisconnected: {
		color: '#FF3B30',
	},
	fab: {
		bottom: theme.spacing(2),
	},
	fabGlass: {
		width: 44,
		height: 44,
		borderRadius: 28,
		alignItems: 'center',
		justifyContent: 'center',
	},
	fabText: {
		color: theme.colors.text,
		fontSize: 28,
		fontWeight: '300',
	},
}))
