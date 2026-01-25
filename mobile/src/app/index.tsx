import { Link, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { FlatList, Pressable, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { api, getServerUrl, type Session } from '@/services/api'

export default function HomeScreen() {
	const [sessions, setSessions] = useState<Session[]>([])
	const [loading, setLoading] = useState(true)
	const [configured, setConfigured] = useState(true)

	const loadSessions = useCallback(async () => {
		setLoading(true)
		const url = await getServerUrl()
		if (!url) {
			setConfigured(false)
			setLoading(false)
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
				<View style={styles.setup}>
					<Text style={styles.setupTitle}>Welcome to Klaude</Text>
					<Text style={styles.setupText}>
						Configure your server connection to get started.
					</Text>
					<Link href="/settings" asChild>
						<Pressable style={styles.button}>
							<Text style={styles.buttonText}>[ CONFIGURE SERVER ]</Text>
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
				ListEmptyComponent={
					<View style={styles.empty}>
						<Text style={styles.emptyText}>
							{loading ? 'Loading...' : 'No active sessions'}
						</Text>
					</View>
				}
				renderItem={({ item }) => (
					<Link href={`/sessions/${item.id}`} asChild>
						<Pressable style={styles.sessionItem}>
							<Text style={styles.sessionName}>{item.branch}</Text>
							<Text style={styles.sessionRepo}>{item.repoName}</Text>
						</Pressable>
					</Link>
				)}
			/>
			<View style={styles.footer}>
				<Link href="/new-session" asChild>
					<Pressable style={styles.button}>
						<Text style={styles.buttonText}>[ NEW SESSION ]</Text>
					</Pressable>
				</Link>
				<View style={styles.footerRow}>
					<Link href="/repos" asChild>
						<Pressable style={styles.buttonSecondary}>
							<Text style={styles.buttonTextSecondary}>[ REPOS ]</Text>
						</Pressable>
					</Link>
					<Link href="/settings" asChild>
						<Pressable style={styles.buttonSecondary}>
							<Text style={styles.buttonTextSecondary}>[ SETTINGS ]</Text>
						</Pressable>
					</Link>
				</View>
			</View>
		</View>
	)
}

const styles = StyleSheet.create(theme => ({
	container: {
		flex: 1,
		backgroundColor: theme.colors.background,
	},
	setup: {
		flex: 1,
		justifyContent: 'center',
		alignItems: 'center',
		padding: theme.spacing(8),
	},
	setupTitle: {
		color: theme.colors.text,
		fontFamily: theme.fonts.mono,
		fontSize: 20,
		marginBottom: theme.spacing(4),
	},
	setupText: {
		color: theme.colors.textDim,
		fontFamily: theme.fonts.mono,
		fontSize: 14,
		textAlign: 'center',
		marginBottom: theme.spacing(8),
	},
	list: {
		padding: theme.spacing(4),
		flexGrow: 1,
	},
	empty: {
		flex: 1,
		justifyContent: 'center',
		alignItems: 'center',
		paddingTop: theme.spacing(20),
	},
	emptyText: {
		color: theme.colors.textDim,
		fontFamily: theme.fonts.mono,
		fontSize: 14,
	},
	sessionItem: {
		borderWidth: 1,
		borderColor: theme.colors.border,
		padding: theme.spacing(4),
		marginBottom: theme.spacing(2),
	},
	sessionName: {
		color: theme.colors.accent,
		fontFamily: theme.fonts.mono,
		fontSize: 16,
	},
	sessionRepo: {
		color: theme.colors.textDim,
		fontFamily: theme.fonts.mono,
		fontSize: 12,
		marginTop: theme.spacing(1),
	},
	footer: {
		padding: theme.spacing(4),
		gap: theme.spacing(2),
		borderTopWidth: 1,
		borderTopColor: theme.colors.border,
	},
	footerRow: {
		flexDirection: 'row',
		gap: theme.spacing(2),
	},
	button: {
		borderWidth: 1,
		borderColor: theme.colors.text,
		padding: theme.spacing(4),
		alignItems: 'center',
	},
	buttonText: {
		color: theme.colors.text,
		fontFamily: theme.fonts.mono,
		fontSize: 14,
	},
	buttonSecondary: {
		flex: 1,
		borderWidth: 1,
		borderColor: theme.colors.border,
		padding: theme.spacing(4),
		alignItems: 'center',
	},
	buttonTextSecondary: {
		color: theme.colors.textDim,
		fontFamily: theme.fonts.mono,
		fontSize: 14,
	},
}))
