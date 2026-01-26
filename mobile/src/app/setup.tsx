import { router, useLocalSearchParams } from 'expo-router'
import { useEffect } from 'react'
import { Alert, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { setServerUrl } from '@/services/api'

export default function SetupScreen() {
	const params = useLocalSearchParams<{ serverUrl?: string }>()

	useEffect(() => {
		const { serverUrl } = params

		if (serverUrl) {
			setServerUrl(serverUrl)
				.then(() => {
					Alert.alert('Connected', `Server configured:\n${serverUrl}`, [
						{ text: 'OK', onPress: () => router.replace('/(tabs)') },
					])
				})
				.catch(() => {
					Alert.alert('Error', 'Failed to save configuration', [
						{ text: 'OK', onPress: () => router.replace('/(tabs)') },
					])
				})
		} else {
			router.replace('/(tabs)')
		}
	}, [params])

	return (
		<View style={styles.container}>
			<Text style={styles.text}>Configuring...</Text>
		</View>
	)
}

const styles = StyleSheet.create(theme => ({
	container: {
		flex: 1,
		backgroundColor: theme.colors.background,
		justifyContent: 'center',
		alignItems: 'center',
	},
	text: {
		color: theme.colors.textSecondary,
		fontSize: 16,
	},
}))
