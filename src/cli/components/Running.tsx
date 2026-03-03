import { Box, Text, useApp } from 'ink'
import qrcode from 'qrcode-terminal'
import { useEffect, useState } from 'react'

interface Props {
	serverUrl: string
	terminalHost: string
	background?: boolean
	pid?: number
}

export function Running({ serverUrl, terminalHost, background, pid }: Props) {
	const [qr, setQr] = useState<string>('')
	const { exit } = useApp()

	const deepLink = `grove://setup?serverUrl=${encodeURIComponent(serverUrl)}&terminalHost=${encodeURIComponent(terminalHost)}`

	useEffect(() => {
		qrcode.generate(deepLink, { small: true }, code => {
			setQr(code)
		})
	}, [deepLink])

	useEffect(() => {
		if (background && qr) {
			const timer = setTimeout(() => {
				exit()
			}, 100)
			return () => clearTimeout(timer)
		}
	}, [background, qr, exit])

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text color="green">✓ grove running at: </Text>
				<Text color="cyan" bold>
					{serverUrl}
				</Text>
			</Box>
			<Text dimColor>
				Scan QR code to configure the grove app automatically.
			</Text>
			<Box marginTop={1}>
				<Text>{qr}</Text>
			</Box>
			<Box marginTop={1}>
				{background ? (
					<Box flexDirection="column">
						<Text color="yellow">Running in background (PID: {pid})</Text>
						<Text dimColor>Run "grove --stop" to stop</Text>
					</Box>
				) : (
					<Text dimColor>Press Ctrl+C to stop</Text>
				)}
			</Box>
		</Box>
	)
}
