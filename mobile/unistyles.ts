import { StyleSheet } from 'react-native-unistyles'

const darkTheme = {
	colors: {
		background: '#0A0A0A',
		surface: '#1C1C1E',
		surfaceElevated: '#2C2C2E',
		text: '#FFFFFF',
		textSecondary: '#8E8E93',
		textTertiary: '#636366',
		border: '#38383A',
		accent: '#0A84FF',
		destructive: '#FF453A',
		success: '#30D158',
	},
	fonts: {
		mono: 'SpaceMono',
	},
	radius: {
		sm: 8,
		md: 12,
		lg: 16,
	},
	spacing: (v: number) => v * 4,
} as const

const appThemes = {
	dark: darkTheme,
	light: darkTheme,
}

const breakpoints = {
	xs: 0,
	sm: 390,
	md: 768,
	lg: 1024,
}

type AppBreakpoints = typeof breakpoints
type AppThemes = typeof appThemes

declare module 'react-native-unistyles' {
	export interface UnistylesThemes extends AppThemes {}
	export interface UnistylesBreakpoints extends AppBreakpoints {}
}

StyleSheet.configure({
	themes: appThemes,
	breakpoints,
	settings: {
		initialTheme: 'dark',
	},
})
