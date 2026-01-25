import { Box, Text } from 'ink'
import qrcode from 'qrcode-terminal'
import { useEffect, useState } from 'react'

interface Props {
	url: string
}

export function Running({ url }: Props) {
	const [qr, setQr] = useState<string>('')

	useEffect(() => {
		qrcode.generate(url, { small: true }, code => {
			setQr(code)
		})
	}, [url])

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text color="green">✓ Klaude running at: </Text>
				<Text color="cyan" bold>
					{url}
				</Text>
			</Box>
			<Text dimColor>Scan QR code in app or enter URL manually.</Text>
			<Box marginTop={1}>
				<Text>{qr}</Text>
			</Box>
			<Box marginTop={1}>
				<Text dimColor>Press Ctrl+C to stop</Text>
			</Box>
		</Box>
	)
}
