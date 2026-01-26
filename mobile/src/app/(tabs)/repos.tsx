import { GlassView } from 'expo-glass-effect'
import { Link } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
	Alert,
	FlatList,
	Pressable,
	RefreshControl,
	Text,
	View,
} from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { api, type Repo } from '@/services/api'

export default function ReposScreen() {
	const [repos, setRepos] = useState<Repo[]>([])
	const [loading, setLoading] = useState(true)
	const [refreshing, setRefreshing] = useState(false)

	const loadRepos = useCallback(async (isRefresh = false) => {
		if (isRefresh) setRefreshing(true)
		else setLoading(true)
		try {
			const data = await api.getRepos()
			setRepos(data)
		} catch (e) {
			console.error('Failed to load repos:', e)
		} finally {
			setLoading(false)
			setRefreshing(false)
		}
	}, [])

	useEffect(() => {
		loadRepos()
	}, [loadRepos])

	const handleDelete = (repo: Repo) => {
		Alert.alert('Remove Repo', `Remove ${repo.name} from Klaude?`, [
			{ text: 'Cancel', style: 'cancel' },
			{
				text: 'Remove',
				style: 'destructive',
				onPress: async () => {
					try {
						await api.deleteRepo(repo.id)
						setRepos(repos.filter(r => r.id !== repo.id))
					} catch (e) {
						console.error('Failed to delete repo:', e)
					}
				},
			},
		])
	}

	return (
		<View style={styles.container}>
			<FlatList
				data={repos}
				keyExtractor={item => item.id}
				contentContainerStyle={styles.list}
				refreshControl={
					<RefreshControl
						refreshing={refreshing}
						onRefresh={() => loadRepos(true)}
						tintColor="#8E8E93"
					/>
				}
				ListEmptyComponent={
					<View style={styles.emptyContainer}>
						<Text style={styles.emptyText}>
							{loading ? 'Loading...' : 'No repos added'}
						</Text>
					</View>
				}
				renderItem={({ item }) => (
					<Pressable
						style={styles.card}
						onLongPress={() => handleDelete(item)}
						delayLongPress={500}
					>
						<View style={styles.cardContent}>
							<Text style={styles.cardTitle}>{item.name}</Text>
							<Text style={styles.cardSubtitle}>{item.path}</Text>
						</View>
						<Pressable
							style={styles.deleteButton}
							onPress={() => handleDelete(item)}
							hitSlop={8}
						>
							<Text style={styles.deleteText}>Remove</Text>
						</Pressable>
					</Pressable>
				)}
			/>
			<Link href="/add-repo" asChild>
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
		paddingTop: rt.insets.top + 48,
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
	list: {
		padding: theme.spacing(4),
		flexGrow: 1,
	},
	card: {
		backgroundColor: theme.colors.surface,
		padding: theme.spacing(4),
		borderRadius: theme.radius.md,
		marginBottom: theme.spacing(3),
		flexDirection: 'row',
		alignItems: 'center',
	},
	cardContent: {
		flex: 1,
	},
	cardTitle: {
		color: theme.colors.text,
		fontSize: 17,
		fontWeight: '500',
	},
	cardSubtitle: {
		color: theme.colors.textSecondary,
		fontSize: 13,
		fontFamily: theme.fonts.mono,
		marginTop: theme.spacing(1),
	},
	deleteButton: {
		paddingVertical: theme.spacing(2),
		paddingHorizontal: theme.spacing(3),
	},
	deleteText: {
		color: theme.colors.destructive,
		fontSize: 14,
	},
	fab: {
		position: 'absolute',
		right: theme.spacing(4),
		top: rt.insets.top,
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
