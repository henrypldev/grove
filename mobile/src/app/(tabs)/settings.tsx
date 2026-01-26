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
import {
	getServerUrl,
	getTerminalHost,
	setServerUrl,
	setTerminalHost,
} from '@/services/api'

export default function SettingsScreen() {
	const [url, setUrl] = useState('')
	const [host, setHost] = useState('')
	const [loading, setLoading] = useState(true)
	const [hasChanges, setHasChanges] = useState(false)
	const [originalUrl, setOriginalUrl] = useState('')
	const [originalHost, setOriginalHost] = useState('')

	const version = Constants.expoConfig?.version ?? '1.0.0'

	const loadSettings = useCallback(async () => {
		const [currentUrl, currentHost] = await Promise.all([
			getServerUrl(),
			getTerminalHost(),
		])
		if (currentUrl) {
			setUrl(currentUrl)
			setOriginalUrl(currentUrl)
		}
		if (currentHost) {
			setHost(currentHost)
			setOriginalHost(currentHost)
		}
		setLoading(false)
	}, [])

	useEffect(() => {
		loadSettings()
	}, [loadSettings])

	useEffect(() => {
		setHasChanges(url !== originalUrl || host !== originalHost)
	}, [url, host, originalUrl, originalHost])

	const handleSave = useCallback(async () => {
		if (!url.trim()) {
			Alert.alert('Error', 'Please enter a server URL')
			return
		}
		if (!host.trim()) {
			Alert.alert('Error', 'Please enter a terminal host')
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
		await Promise.all([
			setServerUrl(normalizedUrl),
			setTerminalHost(host.trim()),
		])
		setOriginalUrl(normalizedUrl)
		setOriginalHost(host.trim())
		setUrl(normalizedUrl)
		Alert.alert('Saved', 'Settings updated successfully')
	}, [url, host])

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
					<View style={styles.separator} />
					<View style={styles.row}>
						<Text style={styles.label}>Terminal Host</Text>
						<TextInput
							style={styles.input}
							value={host}
							onChangeText={setHost}
							placeholder="100.x.x.x"
							placeholderTextColor="#636366"
							autoCapitalize="none"
							autoCorrect={false}
							keyboardType="url"
						/>
					</View>
				</View>
				<Text style={styles.footnote}>
					API Server is the Tailscale Funnel URL. Terminal Host is the direct
					Tailscale IP for terminal connections.
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

const styles = StyleSheet.create(theme => ({
	container: {
		flex: 1,
		backgroundColor: theme.colors.background,
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
	separator: {
		height: 1,
		backgroundColor: theme.colors.border,
		marginLeft: theme.spacing(4),
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
