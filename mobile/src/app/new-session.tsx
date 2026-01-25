import { router } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
	Alert,
	FlatList,
	Pressable,
	Switch,
	Text,
	TextInput,
	View,
} from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { api, type Repo, type Worktree } from '@/services/api'

type Step = 'repo' | 'worktree' | 'create'

export default function NewSessionScreen() {
	const [step, setStep] = useState<Step>('repo')
	const [repos, setRepos] = useState<Repo[]>([])
	const [worktrees, setWorktrees] = useState<Worktree[]>([])
	const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null)
	const [, setSelectedWorktree] = useState<Worktree | null>(null)
	const [newBranch, setNewBranch] = useState('')
	const [baseBranch, setBaseBranch] = useState('main')
	const [loading, setLoading] = useState(false)
	const [skipPermissions, setSkipPermissions] = useState(false)

	const loadRepos = useCallback(async () => {
		try {
			const data = await api.getRepos()
			setRepos(data)
		} catch (e) {
			console.error('Failed to load repos:', e)
		}
	}, [])

	useEffect(() => {
		loadRepos()
	}, [loadRepos])

	const selectRepo = async (repo: Repo) => {
		setSelectedRepo(repo)
		setStep('worktree')
		try {
			const data = await api.getWorktrees(repo.id)
			setWorktrees(data)
			const main = data.find(w => w.isMain)
			if (main) setBaseBranch(main.branch)
		} catch (e) {
			console.error('Failed to load worktrees:', e)
		}
	}

	const selectWorktree = (worktree: Worktree) => {
		setSelectedWorktree(worktree)
		createSession(worktree.branch)
	}

	const createSession = async (worktreeBranch: string) => {
		if (!selectedRepo) return
		setLoading(true)
		try {
			const session = await api.createSession({
				repoId: selectedRepo.id,
				worktree: worktreeBranch,
				skipPermissions,
			})
			router.replace(`/sessions/${session.id}`)
		} catch (_e) {
			Alert.alert('Error', 'Failed to create session')
			setLoading(false)
		}
	}

	const createWorktreeAndSession = async () => {
		if (!selectedRepo || !newBranch.trim()) return
		setLoading(true)
		try {
			await api.createWorktree({
				repoId: selectedRepo.id,
				branch: newBranch.trim(),
				baseBranch,
			})
			await createSession(newBranch.trim())
		} catch (_e) {
			Alert.alert('Error', 'Failed to create worktree')
			setLoading(false)
		}
	}

	const deleteWorktree = (worktree: Worktree) => {
		if (!selectedRepo || worktree.isMain) return
		Alert.alert('Delete Worktree', `Delete "${worktree.branch}"?`, [
			{ text: 'Cancel', style: 'cancel' },
			{
				text: 'Delete',
				style: 'destructive',
				onPress: async () => {
					try {
						await api.deleteWorktree({
							repoId: selectedRepo.id,
							branch: worktree.branch,
						})
						setWorktrees(prev => prev.filter(w => w.path !== worktree.path))
					} catch (_e) {
						Alert.alert('Error', 'Failed to delete worktree')
					}
				},
			},
		])
	}

	if (step === 'repo') {
		return (
			<View style={styles.container}>
				<Text style={styles.stepTitle}>Select Repository</Text>
				<FlatList
					data={repos}
					keyExtractor={item => item.id}
					contentContainerStyle={styles.list}
					ListEmptyComponent={
						<Text style={styles.emptyText}>No repos. Add one first.</Text>
					}
					renderItem={({ item }) => (
						<Pressable style={styles.item} onPress={() => selectRepo(item)}>
							<Text style={styles.itemText}>{item.name}</Text>
						</Pressable>
					)}
				/>
			</View>
		)
	}

	if (step === 'worktree') {
		const mainWorktree = worktrees.find(w => w.isMain)
		const otherWorktrees = worktrees.filter(w => !w.isMain)

		return (
			<View style={styles.container}>
				<Pressable onPress={() => setStep('repo')}>
					<Text style={styles.backText}>{'< Back'}</Text>
				</Pressable>
				<Text style={styles.stepTitle}>Start Session</Text>

				<View style={styles.toggleRow}>
					<Text style={styles.toggleLabel}>Skip Permissions</Text>
					<Switch
						value={skipPermissions}
						onValueChange={setSkipPermissions}
						trackColor={{ false: '#333', true: '#00FF00' }}
						thumbColor="#FFFFFF"
					/>
				</View>

				{mainWorktree && (
					<View style={styles.currentBranchSection}>
						<Text style={styles.sectionLabel}>Current Branch</Text>
						<Pressable
							onPress={() => selectWorktree(mainWorktree)}
							disabled={loading}
						>
							<View style={styles.currentBranchItem}>
								<Text style={styles.itemText}>{mainWorktree.branch}</Text>
							</View>
						</Pressable>
					</View>
				)}

				<FlatList
					data={otherWorktrees}
					keyExtractor={item => item.path}
					contentContainerStyle={styles.list}
					ListHeaderComponent={
						<View style={styles.createSection}>
							<Text style={styles.sectionLabel}>Create New Worktree</Text>
							<TextInput
								style={styles.input}
								value={newBranch}
								onChangeText={setNewBranch}
								placeholder="feature/my-feature"
								placeholderTextColor="#888888"
								autoCapitalize="none"
								autoCorrect={false}
							/>
							<Text style={styles.hint}>Base branch: {baseBranch}</Text>
							<Pressable
								style={[styles.createButton, loading && styles.buttonDisabled]}
								onPress={createWorktreeAndSession}
								disabled={loading || !newBranch.trim()}
							>
								<Text style={styles.createButtonText}>
									{loading ? '[ CREATING... ]' : '[ CREATE & START ]'}
								</Text>
							</Pressable>
							{otherWorktrees.length > 0 && (
								<Text style={styles.sectionLabel}>Or Select Worktree</Text>
							)}
						</View>
					}
					renderItem={({ item }) => (
						<View style={styles.itemRow}>
							<Pressable
								style={styles.item}
								onPress={() => selectWorktree(item)}
								disabled={loading}
							>
								<Text style={styles.itemText}>{item.branch}</Text>
							</Pressable>
							<Pressable onPress={() => deleteWorktree(item)}>
								<View style={styles.deleteButton}>
									<Text style={styles.deleteText}>×</Text>
								</View>
							</Pressable>
						</View>
					)}
				/>
			</View>
		)
	}

	return null
}

const styles = StyleSheet.create(theme => ({
	container: {
		flex: 1,
		backgroundColor: theme.colors.background,
		padding: theme.spacing(4),
	},
	backText: {
		color: theme.colors.textDim,
		fontFamily: theme.fonts.mono,
		fontSize: 12,
		marginBottom: theme.spacing(4),
	},
	stepTitle: {
		color: theme.colors.text,
		fontFamily: theme.fonts.mono,
		fontSize: 16,
		marginBottom: theme.spacing(4),
	},
	toggleRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		marginBottom: theme.spacing(4),
		paddingVertical: theme.spacing(2),
	},
	toggleLabel: {
		color: theme.colors.textDim,
		fontFamily: theme.fonts.mono,
		fontSize: 12,
	},
	list: {
		flexGrow: 1,
	},
	emptyText: {
		color: theme.colors.textDim,
		fontFamily: theme.fonts.mono,
		fontSize: 14,
		textAlign: 'center',
		marginTop: theme.spacing(10),
	},
	itemRow: {
		flexDirection: 'row',
		alignItems: 'stretch',
		marginBottom: theme.spacing(2),
		gap: theme.spacing(1),
	},
	item: {
		flex: 1,
		borderWidth: 1,
		borderColor: theme.colors.border,
		padding: theme.spacing(4),
		flexDirection: 'row',
		alignItems: 'center',
	},
	deleteButton: {
		borderWidth: 1,
		borderColor: '#FF4444F9',
		paddingHorizontal: theme.spacing(4),
		justifyContent: 'center',
		alignItems: 'center',
		flex: 1,
	},
	deleteText: {
		color: '#FF4444F9',
		fontFamily: theme.fonts.mono,
		fontSize: 20,
	},
	itemText: {
		color: theme.colors.text,
		fontFamily: theme.fonts.mono,
		fontSize: 14,
	},
	mainBadge: {
		color: theme.colors.textDim,
		fontFamily: theme.fonts.mono,
		fontSize: 10,
	},
	currentBranchSection: {
		marginBottom: theme.spacing(4),
	},
	currentBranchItem: {
		borderWidth: 1,
		borderColor: theme.colors.accent,
		padding: theme.spacing(4),
	},
	createSection: {
		marginBottom: theme.spacing(4),
	},
	sectionLabel: {
		color: theme.colors.textDim,
		fontFamily: theme.fonts.mono,
		fontSize: 12,
		marginBottom: theme.spacing(2),
		marginTop: theme.spacing(4),
	},
	input: {
		borderWidth: 1,
		borderColor: theme.colors.border,
		padding: theme.spacing(3),
		color: theme.colors.text,
		fontFamily: theme.fonts.mono,
		fontSize: 14,
	},
	hint: {
		color: theme.colors.textDim,
		fontFamily: theme.fonts.mono,
		fontSize: 11,
		marginTop: theme.spacing(1),
	},
	createButton: {
		borderWidth: 1,
		borderColor: theme.colors.accent,
		padding: theme.spacing(3),
		alignItems: 'center',
		marginTop: theme.spacing(3),
	},
	buttonDisabled: {
		borderColor: theme.colors.border,
	},
	createButtonText: {
		color: theme.colors.accent,
		fontFamily: theme.fonts.mono,
		fontSize: 12,
	},
}))
