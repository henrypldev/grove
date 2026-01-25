import { router } from 'expo-router'
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

	const loadSettings = useCallback(async () => {
		const [currentUrl, currentHost] = await Promise.all([
			getServerUrl(),
			getTerminalHost(),
		])
		if (currentUrl) setUrl(currentUrl)
		if (currentHost) setHost(currentHost)
		setLoading(false)
	}, [])

	useEffect(() => {
		loadSettings()
	}, [loadSettings])

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
		router.back()
	}, [url, host])

	if (loading) {
		return (
			<View style={styles.container}>
				<Text style={styles.loadingText}>Loading...</Text>
			</View>
		)
	}

	return (
		<ScrollView style={styles.container} contentContainerStyle={styles.content}>
			<Text style={styles.label}>API Server (Funnel)</Text>
			<TextInput
				style={styles.input}
				value={url}
				onChangeText={setUrl}
				placeholder="macbook.brown-ling.ts.net"
				placeholderTextColor="#888888"
				autoCapitalize="none"
				autoCorrect={false}
				keyboardType="url"
			/>
			<Text style={styles.hint}>Tailscale Funnel URL for API requests</Text>

			<Text style={[styles.label, styles.labelSpaced]}>
				Terminal Host (Direct)
			</Text>
			<TextInput
				style={styles.input}
				value={host}
				onChangeText={setHost}
				placeholder="100.x.x.x"
				placeholderTextColor="#888888"
				autoCapitalize="none"
				autoCorrect={false}
				keyboardType="url"
			/>
			<Text style={styles.hint}>
				Direct Tailscale IP for terminal connections
			</Text>

			<Pressable style={styles.button} onPress={handleSave}>
				<Text style={styles.buttonText}>[ SAVE ]</Text>
			</Pressable>
		</ScrollView>
	)
}

const styles = StyleSheet.create(theme => ({
	container: {
		flex: 1,
		backgroundColor: theme.colors.background,
	},
	content: {
		padding: theme.spacing(4),
	},
	loadingText: {
		color: theme.colors.textDim,
		fontFamily: theme.fonts.mono,
		fontSize: 14,
		textAlign: 'center',
		marginTop: theme.spacing(20),
	},
	label: {
		color: theme.colors.textDim,
		fontFamily: theme.fonts.mono,
		fontSize: 12,
		marginBottom: theme.spacing(2),
	},
	labelSpaced: {
		marginTop: theme.spacing(6),
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
		marginTop: theme.spacing(2),
	},
	button: {
		borderWidth: 1,
		borderColor: theme.colors.text,
		padding: theme.spacing(4),
		alignItems: 'center',
		marginTop: theme.spacing(6),
	},
	buttonText: {
		color: theme.colors.text,
		fontFamily: theme.fonts.mono,
		fontSize: 14,
	},
}))
