import { router, useLocalSearchParams } from 'expo-router'
import { useEffect } from 'react'
import { Alert, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { setServerUrl, setTerminalHost } from '@/services/api'

export default function SetupScreen() {
	const params = useLocalSearchParams<{
		serverUrl?: string
		terminalHost?: string
	}>()

	useEffect(() => {
		const { serverUrl, terminalHost } = params

		if (serverUrl && terminalHost) {
			Promise.all([setServerUrl(serverUrl), setTerminalHost(terminalHost)])
				.then(() => {
					Alert.alert('Connected', `Server configured:\n${serverUrl}`, [
						{ text: 'OK', onPress: () => router.replace('/') },
					])
				})
				.catch(() => {
					Alert.alert('Error', 'Failed to save configuration', [
						{ text: 'OK', onPress: () => router.replace('/') },
					])
				})
		} else {
			router.replace('/')
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
		color: theme.colors.text,
		fontFamily: theme.fonts.mono,
		fontSize: 14,
	},
}))
