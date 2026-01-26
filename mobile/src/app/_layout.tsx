import { useFonts } from 'expo-font'
import * as Linking from 'expo-linking'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { Alert } from 'react-native'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { setServerUrl, setTerminalHost } from '@/services/api'

export { ErrorBoundary } from 'expo-router'

SplashScreen.preventAutoHideAsync()

function handleDeepLink(url: string) {
	const parsed = Linking.parse(url)
	if (parsed.hostname === 'setup' && parsed.queryParams) {
		const { serverUrl, terminalHost } = parsed.queryParams
		if (typeof serverUrl === 'string' && typeof terminalHost === 'string') {
			Promise.all([setServerUrl(serverUrl), setTerminalHost(terminalHost)])
				.then(() => {
					Alert.alert('Connected', `Server configured:\n${serverUrl}`)
				})
				.catch(() => {
					Alert.alert('Error', 'Failed to save configuration')
				})
		}
	}
}

export default function RootLayout() {
	const [loaded, error] = useFonts({
		SpaceMono: require('../../assets/fonts/SpaceMono-Regular.ttf'),
	})

	useEffect(() => {
		if (error) throw error
	}, [error])

	useEffect(() => {
		if (loaded) {
			SplashScreen.hideAsync()
		}
	}, [loaded])

	useEffect(() => {
		Linking.getInitialURL().then(url => {
			if (url) handleDeepLink(url)
		})

		const subscription = Linking.addEventListener('url', ({ url }) => {
			handleDeepLink(url)
		})

		return () => subscription.remove()
	}, [])

	if (!loaded) {
		return null
	}

	return (
		<KeyboardProvider>
			<StatusBar style="light" />
			<Stack
				screenOptions={{
					headerStyle: { backgroundColor: '#000000' },
					headerTintColor: '#FFFFFF',
					headerTitleStyle: { fontFamily: 'SpaceMono' },
					contentStyle: { backgroundColor: '#000000' },
					headerBackButtonDisplayMode: 'minimal',
				}}
			>
				<Stack.Screen name="index" options={{ title: 'Klaude' }} />
				<Stack.Screen name="sessions/[id]" options={{ title: '' }} />
				<Stack.Screen name="repos/index" options={{ title: 'Repos' }} />
				<Stack.Screen
					name="repos/add"
					options={{ title: 'Add Repo', presentation: 'modal' }}
				/>
				<Stack.Screen
					name="new-session"
					options={{ title: 'New Session', presentation: 'modal' }}
				/>
				<Stack.Screen
					name="settings"
					options={{ title: 'Settings', presentation: 'modal' }}
				/>
			</Stack>
		</KeyboardProvider>
	)
}
