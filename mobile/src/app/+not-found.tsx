import { Link, Stack } from 'expo-router'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'

export default function NotFoundScreen() {
	return (
		<>
			<Stack.Screen options={{ title: '404' }} />
			<View style={styles.container}>
				<Text style={styles.text}>Screen not found.</Text>
				<Link href="/" asChild>
					<Pressable style={styles.link}>
						<Text style={styles.linkText}>[ GO HOME ]</Text>
					</Pressable>
				</Link>
			</View>
		</>
	)
}

const styles = StyleSheet.create(theme => ({
	container: {
		flex: 1,
		backgroundColor: theme.colors.background,
		alignItems: 'center',
		justifyContent: 'center',
		padding: theme.spacing(4),
	},
	text: {
		color: theme.colors.textDim,
		fontFamily: theme.fonts.mono,
		fontSize: 14,
	},
	link: {
		marginTop: theme.spacing(4),
		padding: theme.spacing(3),
		borderWidth: 1,
		borderColor: theme.colors.border,
	},
	linkText: {
		color: theme.colors.text,
		fontFamily: theme.fonts.mono,
		fontSize: 12,
	},
}))
