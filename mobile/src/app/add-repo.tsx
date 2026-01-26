import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, Pressable, Text, TextInput, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { api } from '@/services/api'

export default function AddRepoScreen() {
	const [path, setPath] = useState('')
	const [loading, setLoading] = useState(false)

	const handleAdd = async () => {
		if (!path.trim()) return
		setLoading(true)
		try {
			await api.addRepo(path.trim())
			router.back()
		} catch (_e) {
			Alert.alert('Error', 'Failed to add repo. Make sure the path is valid.')
		} finally {
			setLoading(false)
		}
	}

	const isValid = path.trim().length > 0

	return (
		<View style={styles.container}>
			<Text style={styles.label}>Repository Path</Text>
			<TextInput
				style={styles.input}
				value={path}
				onChangeText={setPath}
				placeholder="/Users/you/Projects/your-repo"
				placeholderTextColor="#636366"
				autoCapitalize="none"
				autoCorrect={false}
				autoFocus
			/>
			<Text style={styles.hint}>
				Enter the full path to a git repository on your Mac.
			</Text>
			<Pressable
				style={[styles.button, (!isValid || loading) && styles.buttonDisabled]}
				onPress={handleAdd}
				disabled={loading || !isValid}
			>
				<Text
					style={[
						styles.buttonText,
						(!isValid || loading) && styles.buttonTextDisabled,
					]}
				>
					{loading ? 'Adding...' : 'Add Repository'}
				</Text>
			</Pressable>
		</View>
	)
}

const styles = StyleSheet.create(theme => ({
	container: {
		flex: 1,
		backgroundColor: theme.colors.background,
		padding: theme.spacing(4),
	},
	label: {
		color: theme.colors.textSecondary,
		fontSize: 13,
		fontWeight: '500',
		marginBottom: theme.spacing(2),
		marginTop: theme.spacing(2),
	},
	input: {
		backgroundColor: theme.colors.surface,
		borderRadius: theme.radius.sm,
		padding: theme.spacing(4),
		color: theme.colors.text,
		fontSize: 16,
		fontFamily: theme.fonts.mono,
	},
	hint: {
		color: theme.colors.textSecondary,
		fontSize: 13,
		marginTop: theme.spacing(2),
		lineHeight: 18,
	},
	button: {
		backgroundColor: theme.colors.accent,
		padding: theme.spacing(4),
		borderRadius: theme.radius.md,
		alignItems: 'center',
		marginTop: theme.spacing(6),
	},
	buttonDisabled: {
		backgroundColor: theme.colors.surface,
	},
	buttonText: {
		color: theme.colors.text,
		fontSize: 17,
		fontWeight: '600',
	},
	buttonTextDisabled: {
		color: theme.colors.textTertiary,
	},
}))
