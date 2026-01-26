import Constants from 'expo-constants'
import { useCallback, useEffect, useState } from 'react'
import {
	Alert,
	Pressable,
	ScrollView,
	Text,
	TextInput,
	View,
} from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { getServerUrl, setServerUrl } from '@/services/api'

export default function SettingsScreen() {
	const [url, setUrl] = useState('')
	const [loading, setLoading] = useState(true)
	const [hasChanges, setHasChanges] = useState(false)
	const [originalUrl, setOriginalUrl] = useState('')

	const version = Constants.expoConfig?.version ?? '1.0.0'

	const loadSettings = useCallback(async () => {
		const currentUrl = await getServerUrl()
		if (currentUrl) {
			setUrl(currentUrl)
			setOriginalUrl(currentUrl)
		}
		setLoading(false)
	}, [])

	useEffect(() => {
		loadSettings()
	}, [loadSettings])

	useEffect(() => {
		setHasChanges(url !== originalUrl)
	}, [url, originalUrl])

	const handleSave = useCallback(async () => {
		if (!url.trim()) {
			Alert.alert('Error', 'Please enter a server URL')
			return
		}
		let normalizedUrl = url.trim()
		if (!normalizedUrl.startsWith('http')) {
			const isHttps = normalizedUrl.includes('.ts.net')
			normalizedUrl = `${isHttps ? 'https' : 'http'}://${normalizedUrl}`
		}
		if (normalizedUrl.endsWith('/')) {
			normalizedUrl = normalizedUrl.slice(0, -1)
		}
		await setServerUrl(normalizedUrl)
		setOriginalUrl(normalizedUrl)
		setUrl(normalizedUrl)
		Alert.alert('Saved', 'Settings updated successfully')
	}, [url])

	if (loading) {
		return (
			<View style={styles.container}>
				<View style={styles.centered}>
					<Text style={styles.loadingText}>Loading...</Text>
				</View>
			</View>
		)
	}

	return (
		<View style={styles.container}>
			<ScrollView contentContainerStyle={styles.content}>
				<Text style={styles.sectionHeader}>SERVER</Text>
				<View style={styles.section}>
					<View style={styles.row}>
						<Text style={styles.label}>API Server</Text>
						<TextInput
							style={styles.input}
							value={url}
							onChangeText={setUrl}
							placeholder="macbook.tail1234.ts.net/klaude"
							placeholderTextColor="#636366"
							autoCapitalize="none"
							autoCorrect={false}
							keyboardType="url"
						/>
					</View>
				</View>
				<Text style={styles.footnote}>
					The Tailscale Funnel URL for the Klaude server.
				</Text>

				{hasChanges && (
					<Pressable style={styles.saveButton} onPress={handleSave}>
						<Text style={styles.saveButtonText}>Save Changes</Text>
					</Pressable>
				)}

				<Text style={styles.sectionHeader}>ABOUT</Text>
				<View style={styles.section}>
					<View style={styles.row}>
						<Text style={styles.label}>Version</Text>
						<Text style={styles.value}>{version}</Text>
					</View>
				</View>
			</ScrollView>
		</View>
	)
}

const styles = StyleSheet.create((theme, rt) => ({
	container: {
		flex: 1,
		backgroundColor: theme.colors.background,
		paddingTop: rt.insets.top,
	},
	centered: {
		flex: 1,
		justifyContent: 'center',
		alignItems: 'center',
	},
	loadingText: {
		color: theme.colors.textSecondary,
		fontSize: 16,
	},
	content: {
		padding: theme.spacing(4),
	},
	sectionHeader: {
		color: theme.colors.textSecondary,
		fontSize: 13,
		fontWeight: '500',
		marginBottom: theme.spacing(2),
		marginTop: theme.spacing(4),
		marginLeft: theme.spacing(4),
	},
	section: {
		backgroundColor: theme.colors.surface,
		borderRadius: theme.radius.md,
		overflow: 'hidden',
	},
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		padding: theme.spacing(4),
	},
	label: {
		color: theme.colors.text,
		fontSize: 16,
		width: 120,
	},
	input: {
		flex: 1,
		color: theme.colors.text,
		fontSize: 16,
		textAlign: 'right',
	},
	value: {
		flex: 1,
		color: theme.colors.textSecondary,
		fontSize: 16,
		textAlign: 'right',
	},
	footnote: {
		color: theme.colors.textSecondary,
		fontSize: 13,
		marginTop: theme.spacing(2),
		marginHorizontal: theme.spacing(4),
		lineHeight: 18,
	},
	saveButton: {
		backgroundColor: theme.colors.accent,
		padding: theme.spacing(4),
		borderRadius: theme.radius.md,
		alignItems: 'center',
		marginTop: theme.spacing(6),
	},
	saveButtonText: {
		color: theme.colors.text,
		fontSize: 17,
		fontWeight: '600',
	},
}))
