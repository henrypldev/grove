import { Link, Stack } from 'expo-router'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'

export default function NotFoundScreen() {
	return (
		<>
			<Stack.Screen options={{ title: '404' }} />
			<View style={styles.container}>
				<Text style={styles.title}>Page Not Found</Text>
				<Text style={styles.text}>This screen doesn't exist.</Text>
				<Link href="/" asChild>
					<Pressable style={styles.button}>
						<Text style={styles.buttonText}>Go Home</Text>
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
	title: {
		color: theme.colors.text,
		fontSize: 24,
		fontWeight: '600',
		marginBottom: theme.spacing(2),
	},
	text: {
		color: theme.colors.textSecondary,
		fontSize: 16,
		marginBottom: theme.spacing(6),
	},
	button: {
		backgroundColor: theme.colors.accent,
		paddingVertical: theme.spacing(3),
		paddingHorizontal: theme.spacing(6),
		borderRadius: theme.radius.md,
	},
	buttonText: {
		color: theme.colors.text,
		fontSize: 16,
		fontWeight: '600',
	},
}))
