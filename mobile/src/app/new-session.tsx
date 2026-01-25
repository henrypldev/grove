import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { api, type Repo, type Worktree } from '@/services/api'

type Step = 'repo' | 'worktree' | 'create'

export default function NewSessionScreen() {
	const [step, setStep] = useState<Step>('repo')
	const [repos, setRepos] = useState<Repo[]>([])
	const [worktrees, setWorktrees] = useState<Worktree[]>([])
	const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null)
	const [selectedWorktree, setSelectedWorktree] = useState<Worktree | null>(
		null,
	)
	const [newBranch, setNewBranch] = useState('')
	const [baseBranch, setBaseBranch] = useState('main')
	const [loading, setLoading] = useState(false)

	useEffect(() => {
		loadRepos()
	}, [])

	const loadRepos = async () => {
		try {
			const data = await api.getRepos()
			setRepos(data)
		} catch (e) {
			console.error('Failed to load repos:', e)
		}
	}

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
			await api.createSession({
				repoId: selectedRepo.id,
				worktree: worktreeBranch,
			})
			router.replace('/')
		} catch (e) {
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
		} catch (e) {
			Alert.alert('Error', 'Failed to create worktree')
			setLoading(false)
		}
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
		return (
			<View style={styles.container}>
				<Pressable onPress={() => setStep('repo')}>
					<Text style={styles.backText}>{'< Back'}</Text>
				</Pressable>
				<Text style={styles.stepTitle}>Select or Create Worktree</Text>
				<FlatList
					data={worktrees}
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
							<Text style={styles.sectionLabel}>Or Select Existing</Text>
						</View>
					}
					renderItem={({ item }) => (
						<Pressable
							style={styles.item}
							onPress={() => selectWorktree(item)}
							disabled={loading}
						>
							<Text style={styles.itemText}>{item.branch}</Text>
							{item.isMain && <Text style={styles.mainBadge}>[main]</Text>}
						</Pressable>
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
	item: {
		borderWidth: 1,
		borderColor: theme.colors.border,
		padding: theme.spacing(4),
		marginBottom: theme.spacing(2),
		flexDirection: 'row',
		alignItems: 'center',
	},
	itemText: {
		color: theme.colors.text,
		fontFamily: theme.fonts.mono,
		fontSize: 14,
		flex: 1,
	},
	mainBadge: {
		color: theme.colors.textDim,
		fontFamily: theme.fonts.mono,
		fontSize: 10,
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
