import { RootProvider } from 'fumadocs-ui/provider/next'
import './global.css'
import type { ReactNode } from 'react'

export const metadata = {
	title: 'Grove',
	description: 'Mobile terminal server for Claude Code',
}

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body>
				<RootProvider>{children}</RootProvider>
			</body>
		</html>
	)
}
