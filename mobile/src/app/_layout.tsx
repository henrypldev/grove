import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { StyleSheet } from 'react-native-unistyles'
import { subscribeToConnection } from '@/services/api'

export { ErrorBoundary } from 'expo-router'

SplashScreen.preventAutoHideAsync()

function ConnectionIndicator() {
	const [state, setState] = useState({
		connected: false,
		url: null as string | null,
	})

	useEffect(() => {
		return subscribeToConnection(setState)
	}, [])

	if (!state.url) return null

	return (
		<View style={styles.indicatorContainer}>
			<View style={styles.indicator(state.connected)} />
			<Text style={styles.indicatorText}>
				{state.url.replace('https://', '')}
			</Text>
		</View>
	)
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
				<Stack.Screen
					name="(tabs)"
					options={{
						headerShown: true,
						header: () => (
							<View style={styles.header}>
								<ConnectionIndicator />
							</View>
						),
					}}
				/>
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

const styles = StyleSheet.create((theme, rt) => ({
	header: {
		position: 'absolute',
		top: rt.insets.top + 16,
		left: theme.spacing(4),
		zIndex: 100,
	},
	indicatorContainer: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
	},
	indicator: (connected: boolean) => ({
		width: 10,
		height: 10,
		borderRadius: 5,
		backgroundColor: connected ? '#00FF00' : '#FF3B30',
	}),
	indicatorText: {
		color: 'white',
		fontSize: 18,
	},
}))
