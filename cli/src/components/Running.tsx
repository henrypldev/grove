import { Box, Text } from 'ink'
import qrcode from 'qrcode-terminal'
import { useEffect, useState } from 'react'

interface Props {
	serverUrl: string
	terminalHost: string
}

export function Running({ serverUrl, terminalHost }: Props) {
	const [qr, setQr] = useState<string>('')

	const deepLink = `klaude://setup?serverUrl=${encodeURIComponent(serverUrl)}&terminalHost=${encodeURIComponent(terminalHost)}`

	useEffect(() => {
		qrcode.generate(deepLink, { small: true }, code => {
			setQr(code)
		})
	}, [deepLink])

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text color="green">✓ Klaude running at: </Text>
				<Text color="cyan" bold>
					{serverUrl}
				</Text>
			</Box>
			<Text dimColor>
				Scan QR code to configure the Klaude app automatically.
			</Text>
			<Box marginTop={1}>
				<Text>{qr}</Text>
			</Box>
			<Box marginTop={1}>
				<Text dimColor>Press Ctrl+C to stop</Text>
			</Box>
		</Box>
	)
}
