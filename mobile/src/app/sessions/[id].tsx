import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { KeyboardStickyView } from 'react-native-keyboard-controller'
import { StyleSheet } from 'react-native-unistyles'
import { WebView } from 'react-native-webview'
import { api, getTerminalHost, type Session } from '@/services/api'

export default function SessionScreen() {
	const { id } = useLocalSearchParams<{ id: string }>()
	const [session, setSession] = useState<Session | null>(null)
	const [terminalHost, setTerminalHostState] = useState<string | null>(null)
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

	if (!session || !terminalHost) {
		return (
			<View style={styles.container}>
				<View style={styles.centered}>
					<Text style={styles.loadingText}>Loading...</Text>
				</View>
			</View>
		)
	}

	const terminalUrl = `http://${terminalHost}:${session.port}`

	return (
		<>
			<Stack.Screen
				options={{
					headerTitle: session.branch,
					// @ts-expect-error
					unstable_headerRightItems: () => [
						{
							type: 'button',
							icon: { type: 'sfSymbol', name: 'xmark' },
							onPress: () => handleKill(),
						},
					],
				}}
			/>
			<View style={styles.container}>
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
							<Pressable
								style={styles.shortcut}
								onPress={() => sendKey('\x03')}
							>
								<Text style={styles.shortcutText}>^C</Text>
							</Pressable>
							<Pressable
								style={styles.shortcut}
								onPress={() => sendKey('\x04')}
							>
								<Text style={styles.shortcutText}>^D</Text>
							</Pressable>
							<Pressable
								style={styles.shortcut}
								onPress={() => sendKey('\x1b')}
							>
								<Text style={styles.shortcutText}>ESC</Text>
							</Pressable>
						</View>
					</View>
				</KeyboardStickyView>
			</View>
		</>
	)
}

const styles = StyleSheet.create(theme => ({
	container: {
		flex: 1,
		backgroundColor: '#000000',
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
	webview: {
		flex: 1,
		backgroundColor: '#000000',
	},
	inputBar: {
		backgroundColor: theme.colors.surface,
		borderTopWidth: 1,
		borderTopColor: theme.colors.border,
	},
	shortcuts: {
		flexDirection: 'row',
		padding: theme.spacing(3),
		gap: theme.spacing(2),
	},
	shortcut: {
		backgroundColor: theme.colors.background,
		paddingVertical: theme.spacing(2),
		paddingHorizontal: theme.spacing(4),
		borderRadius: theme.radius.sm,
	},
	shortcutText: {
		color: theme.colors.textSecondary,
		fontFamily: theme.fonts.mono,
		fontSize: 14,
	},
}))
