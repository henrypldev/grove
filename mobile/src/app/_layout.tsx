import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { KeyboardProvider } from 'react-native-keyboard-controller'

export { ErrorBoundary } from 'expo-router'

SplashScreen.preventAutoHideAsync()

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
				}}
			>
				<Stack.Screen name="index" options={{ title: 'Klaude' }} />
				<Stack.Screen name="sessions/[id]" options={{ title: 'Session' }} />
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
