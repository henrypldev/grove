import { GlassView } from 'expo-glass-effect'
import { Link, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { api, getServerUrl, type Session } from '@/services/api'

export default function SessionsScreen() {
	const [sessions, setSessions] = useState<Session[]>([])
	const [loading, setLoading] = useState(true)
	const [refreshing, setRefreshing] = useState(false)
	const [configured, setConfigured] = useState(true)

	const loadSessions = useCallback(async (isRefresh = false) => {
		if (isRefresh) setRefreshing(true)
		else setLoading(true)

		const url = await getServerUrl()
		if (!url) {
			setConfigured(false)
			setLoading(false)
			setRefreshing(false)
			return
		}
		setConfigured(true)
		try {
			const data = await api.getSessions()
			setSessions(data)
		} catch (e) {
			console.error('Failed to load sessions:', e)
		} finally {
			setLoading(false)
			setRefreshing(false)
		}
	}, [])

	useFocusEffect(
		useCallback(() => {
			loadSessions()
		}, [loadSessions]),
	)

	if (!configured && !loading) {
		return (
			<View style={styles.container}>
				<View style={styles.centered}>
					<Text style={styles.title}>Welcome to Klaude</Text>
					<Text style={styles.subtitle}>
						Configure your server connection to get started.
					</Text>
					<Link href="/(tabs)/settings" asChild>
						<Pressable style={styles.button}>
							<Text style={styles.buttonText}>Configure Server</Text>
						</Pressable>
					</Link>
				</View>
			</View>
		)
	}

	return (
		<View style={styles.container}>
			<FlatList
				data={sessions}
				keyExtractor={item => item.id}
				contentContainerStyle={styles.list}
				refreshControl={
					<RefreshControl
						refreshing={refreshing}
						onRefresh={() => loadSessions(true)}
						tintColor="#8E8E93"
					/>
				}
				ListEmptyComponent={
					<View style={styles.emptyContainer}>
						<Text style={styles.emptyText}>
							{loading ? 'Loading...' : 'No active sessions'}
						</Text>
					</View>
				}
				renderItem={({ item }) => (
					<Link href={`/sessions/${item.id}`} asChild>
						<Pressable style={styles.card}>
							<Text style={styles.cardTitle}>{item.branch}</Text>
							<Text style={styles.cardSubtitle}>{item.repoName}</Text>
						</Pressable>
					</Link>
				)}
			/>
			<Link href="/new-session" asChild>
				<Pressable style={styles.fab}>
					<GlassView style={styles.fabGlass}>
						<Text style={styles.fabText}>+</Text>
					</GlassView>
				</Pressable>
			</Link>
		</View>
	)
}

const styles = StyleSheet.create((theme, rt) => ({
	container: {
		flex: 1,
		backgroundColor: theme.colors.background,
	},
	centered: {
		flex: 1,
		justifyContent: 'center',
		alignItems: 'center',
		padding: theme.spacing(8),
	},
	title: {
		color: theme.colors.text,
		fontSize: 24,
		fontWeight: '600',
		marginBottom: theme.spacing(2),
	},
	subtitle: {
		color: theme.colors.textSecondary,
		fontSize: 16,
		textAlign: 'center',
		marginBottom: theme.spacing(6),
	},
	button: {
		backgroundColor: theme.colors.accent,
		paddingVertical: theme.spacing(3),
		paddingHorizontal: theme.spacing(6),
		borderRadius: theme.radius.md,
	},
	buttonText: {
		color: theme.colors.text,
		fontSize: 16,
		fontWeight: '600',
	},
	list: {
		padding: theme.spacing(4),
		flexGrow: 1,
	},
	emptyContainer: {
		flex: 1,
		justifyContent: 'center',
		alignItems: 'center',
		paddingTop: theme.spacing(20),
	},
	emptyText: {
		color: theme.colors.textSecondary,
		fontSize: 16,
	},
	card: {
		backgroundColor: theme.colors.surface,
		padding: theme.spacing(4),
		borderRadius: theme.radius.md,
		marginBottom: theme.spacing(3),
	},
	cardTitle: {
		color: theme.colors.text,
		fontSize: 17,
		fontWeight: '500',
		fontFamily: theme.fonts.mono,
	},
	cardSubtitle: {
		color: theme.colors.textSecondary,
		fontSize: 14,
		marginTop: theme.spacing(1),
	},
	fab: {
		position: 'absolute',
		right: theme.spacing(4),
		top: rt.insets.top + 8,
	},
	fabGlass: {
		width: 44,
		height: 44,
		borderRadius: 22,
		alignItems: 'center',
		justifyContent: 'center',
	},
	fabText: {
		color: theme.colors.text,
		fontSize: 24,
		fontWeight: '300',
	},
}))
