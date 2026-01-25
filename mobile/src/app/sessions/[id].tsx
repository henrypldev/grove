import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { KeyboardStickyView } from 'react-native-keyboard-controller'
import { StyleSheet } from 'react-native-unistyles'
import { WebView } from 'react-native-webview'
import { api, getTerminalHost, type Session } from '@/services/api'

export default function SessionScreen() {
	const { id } = useLocalSearchParams<{ id: string }>()
	const [session, setSession] = useState<Session | null>(null)
	const [terminalHost, setTerminalHostState] = useState<string | null>(null)
	const [input, setInput] = useState('')
	const webViewRef = useRef<WebView>(null)

	const loadSession = useCallback(async () => {
		try {
			const host = await getTerminalHost()
			setTerminalHostState(host)
			const sessions = await api.getSessions()
			const found = sessions.find(s => s.id === id)
			setSession(found || null)
		} catch (e) {
			console.error('Failed to load session:', e)
		}
	}, [id])

	useEffect(() => {
		loadSession()
	}, [loadSession])

	const sendInput = (text: string) => {
		if (!webViewRef.current) return
		const escaped = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
		webViewRef.current.injectJavaScript(`
      if (window.term) {
        window.term.paste('${escaped}\\n');
      }
      true;
    `)
		setInput('')
	}

	const sendKey = (key: string) => {
		if (!webViewRef.current) return
		webViewRef.current.injectJavaScript(`
      if (window.term) {
        window.term.paste('${key}');
      }
      true;
    `)
	}

	const handleKill = async () => {
		if (!session) return
		try {
			await api.deleteSession(session.id)
			router.back()
		} catch (e) {
			console.error('Failed to kill session:', e)
		}
	}

	console.log(session, terminalHost)

	if (!session || !terminalHost) {
		return (
			<View style={styles.container}>
				<Text style={styles.loadingText}>Loading...</Text>
			</View>
		)
	}

	const terminalUrl = `http://${terminalHost}:${session.port}`

	return (
		<View style={styles.container}>
			<View style={styles.header}>
				<Text style={styles.headerText}>{session.branch}</Text>
				<Pressable onPress={handleKill} style={styles.killButton}>
					<Text style={styles.killText}>[ KILL ]</Text>
				</Pressable>
			</View>
			<WebView
				ref={webViewRef}
				source={{ uri: terminalUrl }}
				style={styles.webview}
				javaScriptEnabled
				domStorageEnabled
			/>
			<KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
				<View style={styles.inputBar}>
					<View style={styles.shortcuts}>
						<Pressable style={styles.shortcut} onPress={() => sendKey('\x03')}>
							<Text style={styles.shortcutText}>^C</Text>
						</Pressable>
						<Pressable style={styles.shortcut} onPress={() => sendKey('\x04')}>
							<Text style={styles.shortcutText}>^D</Text>
						</Pressable>
						<Pressable style={styles.shortcut} onPress={() => sendKey('\x1b')}>
							<Text style={styles.shortcutText}>ESC</Text>
						</Pressable>
						<Pressable
							style={styles.sendButton}
							onPress={() => sendInput(input)}
						>
							<Text style={styles.sendText}>SEND</Text>
						</Pressable>
					</View>
					<TextInput
						style={styles.input}
						value={input}
						onChangeText={setInput}
						placeholder="> type here..."
						placeholderTextColor="#888888"
						onSubmitEditing={() => sendInput(input)}
						autoCapitalize="none"
						autoCorrect={false}
					/>
				</View>
			</KeyboardStickyView>
		</View>
	)
}

const styles = StyleSheet.create(theme => ({
	container: {
		flex: 1,
		backgroundColor: theme.colors.background,
	},
	loadingText: {
		color: theme.colors.textDim,
		fontFamily: theme.fonts.mono,
		fontSize: 14,
		textAlign: 'center',
		marginTop: theme.spacing(20),
	},
	header: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		padding: theme.spacing(3),
		borderBottomWidth: 1,
		borderBottomColor: theme.colors.border,
	},
	headerText: {
		color: theme.colors.accent,
		fontFamily: theme.fonts.mono,
		fontSize: 14,
	},
	killButton: {
		padding: theme.spacing(2),
	},
	killText: {
		color: theme.colors.error,
		fontFamily: theme.fonts.mono,
		fontSize: 12,
	},
	webview: {
		flex: 1,
		backgroundColor: theme.colors.background,
	},
	inputBar: {
		borderTopWidth: 1,
		borderTopColor: theme.colors.border,
		backgroundColor: theme.colors.background,
	},
	shortcuts: {
		flexDirection: 'row',
		padding: theme.spacing(2),
		gap: theme.spacing(2),
	},
	shortcut: {
		borderWidth: 1,
		borderColor: theme.colors.border,
		paddingVertical: theme.spacing(2),
		paddingHorizontal: theme.spacing(3),
	},
	shortcutText: {
		color: theme.colors.textDim,
		fontFamily: theme.fonts.mono,
		fontSize: 12,
	},
	sendButton: {
		borderWidth: 1,
		borderColor: theme.colors.accent,
		paddingVertical: theme.spacing(2),
		paddingHorizontal: theme.spacing(3),
		marginLeft: 'auto',
	},
	sendText: {
		color: theme.colors.accent,
		fontFamily: theme.fonts.mono,
		fontSize: 12,
	},
	input: {
		borderWidth: 1,
		borderColor: theme.colors.border,
		margin: theme.spacing(2),
		padding: theme.spacing(3),
		color: theme.colors.text,
		fontFamily: theme.fonts.mono,
		fontSize: 14,
	},
}))
