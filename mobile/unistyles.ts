import { StyleSheet } from 'react-native-unistyles'

const terminalTheme = {
  colors: {
    background: '#000000',
    foreground: '#111111',
    text: '#FFFFFF',
    textDim: '#888888',
    border: '#333333',
    accent: '#00FF00',
    error: '#FF0000',
    warning: '#FFFF00',
  },
  fonts: {
    mono: 'SpaceMono',
  },
  spacing: (v: number) => v * 4,
} as const

const appThemes = {
  dark: terminalTheme,
  light: terminalTheme,
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
