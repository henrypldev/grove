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
					headerStyle: { backgroundColor: '#0A0A0A' },
					headerTintColor: '#FFFFFF',
					contentStyle: { backgroundColor: '#0A0A0A' },
					headerBackButtonDisplayMode: 'minimal',
				}}
			>
				<Stack.Screen name="(tabs)" options={{ headerShown: false }} />
				<Stack.Screen
					name="new-session"
					options={{
						title: 'New Session',
						presentation: 'modal',
					}}
				/>
				<Stack.Screen name="sessions/[id]" options={{ title: '' }} />
				<Stack.Screen
					name="add-repo"
					options={{
						title: 'Add Repo',
						presentation: 'modal',
					}}
				/>
				<Stack.Screen
					name="setup"
					options={{
						headerShown: false,
						presentation: 'modal',
						sheetAllowedDetents: 'fitToContents',
					}}
				/>
			</Stack>
		</KeyboardProvider>
	)
}
