import Ionicons from '@expo/vector-icons/Ionicons'
import { Link, useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import {
	FlatList,
	Pressable,
	RefreshControl,
	Text,
	TextInput,
	View,
} from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import {
	api,
	getServerUrl,
	type Session,
	type SessionState,
	subscribeToEvents,
} from '@/services/api'

function getStateLabel(state: SessionState): string {
	switch (state) {
		case 'waiting':
			return 'Waiting for input'
		case 'busy':
			return 'Working...'
		case 'idle':
			return 'Idle'
	}
}

export default function SessionsScreen() {
	const [sessions, setSessions] = useState<Session[]>([])
	const [loading, setLoading] = useState(true)
	const [refreshing, setRefreshing] = useState(false)
	const [configured, setConfigured] = useState(true)
	const [search, setSearch] = useState('')

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
			const unsubscribeEvents = subscribeToEvents(setSessions)
			return () => {
				unsubscribeEvents()
			}
		}, [loadSessions]),
	)

	const filteredSessions = useMemo(() => {
		if (!search.trim()) return sessions
		const query = search.toLowerCase()
		return sessions.filter(
			s =>
				s.repoName.toLowerCase().includes(query) ||
				s.branch.toLowerCase().includes(query),
		)
	}, [sessions, search])

	if (!configured && !loading) {
		return (
			<View style={styles.container}>
				<View style={styles.centered}>
					<Text style={styles.welcomeTitle}>Welcome to Klaude</Text>
					<Text style={styles.welcomeSubtitle}>
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
			<View style={styles.searchContainer}>
				<View style={styles.searchBar}>
					<Ionicons name="search" size={18} color="#8E8E93" />
					<TextInput
						style={styles.searchInput}
						placeholder="Search..."
						placeholderTextColor="#8E8E93"
						value={search}
						onChangeText={setSearch}
						autoCapitalize="none"
						autoCorrect={false}
					/>
				</View>
			</View>

			<FlatList
				data={filteredSessions}
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
							{loading ? 'Loading...' : 'No sessions'}
						</Text>
					</View>
				}
				ItemSeparatorComponent={() => <View style={styles.separator} />}
				renderItem={({ item }) => (
					<Link href={`/sessions/${item.id}`} asChild>
						<Pressable>
							<View style={styles.itemContainer}>
								<View style={styles.row}>
									<View style={styles.rowLeft}>
										<View
											style={[
												styles.statusDot,
												!item.isActive && styles.statusDotInactive,
											]}
										/>
										<Text style={styles.rowText}>
											{item.repoName} · {item.branch}
										</Text>
									</View>
									<Ionicons name="chevron-forward" size={20} color="#8E8E93" />
								</View>
								{item.isActive && (
									<Text style={styles.state}>{getStateLabel(item.state)}</Text>
								)}
							</View>
						</Pressable>
					</Link>
				)}
			/>
		</View>
	)
}

const styles = StyleSheet.create(theme => ({
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
	welcomeTitle: {
		color: theme.colors.text,
		fontSize: 24,
		fontWeight: '600',
		marginBottom: theme.spacing(2),
	},
	welcomeSubtitle: {
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
	searchContainer: {
		paddingHorizontal: theme.spacing(4),
		paddingVertical: theme.spacing(3),
	},
	searchBar: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: theme.colors.surface,
		borderRadius: theme.radius.md,
		paddingHorizontal: theme.spacing(3),
		paddingVertical: theme.spacing(2),
		gap: theme.spacing(2),
	},
	searchInput: {
		flex: 1,
		color: theme.colors.text,
		fontSize: 16,
	},
	list: {
		paddingHorizontal: theme.spacing(4),
		flexGrow: 1,
	},
	itemContainer: {
		flex: 1,
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
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingVertical: theme.spacing(3),
	},
	rowLeft: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: theme.spacing(3),
		flex: 1,
	},
	statusDot: {
		width: 10,
		height: 10,
		borderRadius: 5,
		backgroundColor: '#34C759',
	},
	statusDotInactive: {
		backgroundColor: 'transparent',
	},
	rowText: {
		color: theme.colors.text,
		fontSize: 17,
		flex: 1,
	},
	state: {
		color: theme.colors.textSecondary,
	},
	separator: {
		height: 1,
		backgroundColor: theme.colors.surface,
	},
}))
