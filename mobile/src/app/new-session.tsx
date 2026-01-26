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

type Step = 'repo' | 'worktree'

export default function NewSessionScreen() {
	const [step, setStep] = useState<Step>('repo')
	const [repos, setRepos] = useState<Repo[]>([])
	const [worktrees, setWorktrees] = useState<Worktree[]>([])
	const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null)
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
				<Text style={styles.sectionHeader}>SELECT REPOSITORY</Text>
				<FlatList
					data={repos}
					keyExtractor={item => item.id}
					contentContainerStyle={styles.list}
					ListEmptyComponent={
						<View style={styles.centered}>
							<Text style={styles.emptyText}>No repos added yet.</Text>
						</View>
					}
					renderItem={({ item }) => (
						<Pressable style={styles.card} onPress={() => selectRepo(item)}>
							<Text style={styles.cardTitle}>{item.name}</Text>
							<Text style={styles.cardSubtitle}>{item.path}</Text>
						</Pressable>
					)}
				/>
			</View>
		)
	}

	const mainWorktree = worktrees.find(w => w.isMain)
	const otherWorktrees = worktrees.filter(w => !w.isMain)

	return (
		<View style={styles.container}>
			<Pressable style={styles.backButton} onPress={() => setStep('repo')}>
				<Text style={styles.backText}>← Back</Text>
			</Pressable>

			<View style={styles.optionRow}>
				<View>
					<Text style={styles.optionLabel}>Skip Permissions</Text>
					<Text style={styles.optionHint}>Start session without asking</Text>
				</View>
				<Switch
					value={skipPermissions}
					onValueChange={setSkipPermissions}
					trackColor={{ false: '#38383A', true: '#30D158' }}
					thumbColor="#FFFFFF"
				/>
			</View>

			{mainWorktree && (
				<>
					<Text style={styles.sectionHeader}>CURRENT BRANCH</Text>
					<Pressable
						style={styles.cardHighlight}
						onPress={() => selectWorktree(mainWorktree)}
						disabled={loading}
					>
						<Text style={styles.cardTitleMono}>{mainWorktree.branch}</Text>
					</Pressable>
				</>
			)}

			<Text style={styles.sectionHeader}>CREATE NEW WORKTREE</Text>
			<View style={styles.createSection}>
				<TextInput
					style={styles.input}
					value={newBranch}
					onChangeText={setNewBranch}
					placeholder="feature/my-feature"
					placeholderTextColor="#636366"
					autoCapitalize="none"
					autoCorrect={false}
				/>
				<Text style={styles.hint}>Branch from: {baseBranch}</Text>
				<Pressable
					style={[
						styles.button,
						(loading || !newBranch.trim()) && styles.buttonDisabled,
					]}
					onPress={createWorktreeAndSession}
					disabled={loading || !newBranch.trim()}
				>
					<Text
						style={[
							styles.buttonText,
							(loading || !newBranch.trim()) && styles.buttonTextDisabled,
						]}
					>
						{loading ? 'Creating...' : 'Create & Start'}
					</Text>
				</Pressable>
			</View>

			{otherWorktrees.length > 0 && (
				<>
					<Text style={styles.sectionHeader}>EXISTING WORKTREES</Text>
					<FlatList
						data={otherWorktrees}
						keyExtractor={item => item.path}
						scrollEnabled={false}
						renderItem={({ item }) => (
							<View style={styles.cardRow}>
								<Pressable
									style={styles.cardFlex}
									onPress={() => selectWorktree(item)}
									disabled={loading}
								>
									<Text style={styles.cardTitleMono}>{item.branch}</Text>
								</Pressable>
								<Pressable
									style={styles.deleteButton}
									onPress={() => deleteWorktree(item)}
								>
									<Text style={styles.deleteText}>Remove</Text>
								</Pressable>
							</View>
						)}
					/>
				</>
			)}
		</View>
	)
}

const styles = StyleSheet.create(theme => ({
	container: {
		flex: 1,
		backgroundColor: theme.colors.background,
		padding: theme.spacing(4),
	},
	backButton: {
		marginBottom: theme.spacing(4),
	},
	backText: {
		color: theme.colors.accent,
		fontSize: 16,
	},
	sectionHeader: {
		color: theme.colors.textSecondary,
		fontSize: 13,
		fontWeight: '500',
		marginBottom: theme.spacing(2),
		marginTop: theme.spacing(4),
	},
	list: {
		flexGrow: 1,
	},
	centered: {
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
	cardHighlight: {
		backgroundColor: theme.colors.surface,
		padding: theme.spacing(4),
		borderRadius: theme.radius.md,
		borderWidth: 1,
		borderColor: theme.colors.accent,
	},
	cardRow: {
		flexDirection: 'row',
		gap: theme.spacing(2),
		marginBottom: theme.spacing(2),
	},
	cardFlex: {
		flex: 1,
		backgroundColor: theme.colors.surface,
		padding: theme.spacing(4),
		borderRadius: theme.radius.md,
	},
	cardTitle: {
		color: theme.colors.text,
		fontSize: 17,
		fontWeight: '500',
	},
	cardTitleMono: {
		color: theme.colors.text,
		fontSize: 16,
		fontFamily: theme.fonts.mono,
	},
	cardSubtitle: {
		color: theme.colors.textSecondary,
		fontSize: 13,
		fontFamily: theme.fonts.mono,
		marginTop: theme.spacing(1),
	},
	optionRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		backgroundColor: theme.colors.surface,
		padding: theme.spacing(4),
		borderRadius: theme.radius.md,
	},
	optionLabel: {
		color: theme.colors.text,
		fontSize: 16,
	},
	optionHint: {
		color: theme.colors.textSecondary,
		fontSize: 13,
		marginTop: theme.spacing(1),
	},
	createSection: {
		backgroundColor: theme.colors.surface,
		padding: theme.spacing(4),
		borderRadius: theme.radius.md,
	},
	input: {
		backgroundColor: theme.colors.background,
		borderRadius: theme.radius.sm,
		padding: theme.spacing(3),
		color: theme.colors.text,
		fontSize: 16,
		fontFamily: theme.fonts.mono,
	},
	hint: {
		color: theme.colors.textSecondary,
		fontSize: 13,
		marginTop: theme.spacing(2),
	},
	button: {
		backgroundColor: theme.colors.accent,
		padding: theme.spacing(3),
		borderRadius: theme.radius.sm,
		alignItems: 'center',
		marginTop: theme.spacing(4),
	},
	buttonDisabled: {
		backgroundColor: theme.colors.border,
	},
	buttonText: {
		color: theme.colors.text,
		fontSize: 16,
		fontWeight: '600',
	},
	buttonTextDisabled: {
		color: theme.colors.textTertiary,
	},
	deleteButton: {
		backgroundColor: theme.colors.surface,
		paddingHorizontal: theme.spacing(4),
		borderRadius: theme.radius.md,
		justifyContent: 'center',
	},
	deleteText: {
		color: theme.colors.destructive,
		fontSize: 14,
	},
}))
