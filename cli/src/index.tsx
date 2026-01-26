#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Box, render, Text } from 'ink'
import Spinner from 'ink-spinner'
import { useEffect, useState } from 'react'
import { DepsCheck } from './components/DepsCheck.js'
import { Running } from './components/Running.js'
import { loadConfig, saveConfig } from './config.js'
import { getTailscaleInfo, startFunnel, stopFunnel } from './tunnel.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER_PATH = join(__dirname, '../../server/src/index.ts')

function parseArgs(): { port?: number } {
	const args = process.argv.slice(2)
	const portIndex = args.indexOf('--port')
	if (portIndex !== -1 && args[portIndex + 1]) {
		return { port: parseInt(args[portIndex + 1], 10) }
	}
	return {}
}

type AppState = 'deps-check' | 'starting' | 'running' | 'error'

function App() {
	const [state, setState] = useState<AppState>('deps-check')
	const [error, setError] = useState<string | null>(null)
	const [serverUrl, setServerUrl] = useState<string>('')
	const [terminalHost, setTerminalHost] = useState<string>('')
	const [serverProcess, setServerProcess] = useState<ReturnType<
		typeof spawn
	> | null>(null)

	const args = parseArgs()
	const config = loadConfig()
	const port = args.port ?? config.port

	useEffect(() => {
		if (args.port && args.port !== config.port) {
			saveConfig({ ...config, port: args.port })
		}
	}, [args.port, config])

	const handleDepsComplete = () => {
		setState('starting')
		startServer()
	}

	const startServer = () => {
		const info = getTailscaleInfo()
		if (!info) {
			setError('Could not get Tailscale info. Is Tailscale running?')
			setState('error')
			return
		}

		const proc = spawn('bun', ['run', SERVER_PATH], {
			env: { ...process.env, PORT: String(port) },
			stdio: 'ignore',
		})

		proc.on('error', err => {
			setError(`Failed to start server: ${err.message}`)
			setState('error')
		})

		setServerProcess(proc)

		setTimeout(() => {
			const success = startFunnel(port)
			if (!success) {
				setError('Failed to start Tailscale Funnel')
				proc.kill()
				setState('error')
				return
			}

			setServerUrl(`https://${info.hostname}/klaude`)
			setTerminalHost(info.ip)
			setState('running')
		}, 1000)
	}

	useEffect(() => {
		const cleanup = () => {
			stopFunnel()
			if (serverProcess) {
				serverProcess.kill()
			}
			process.exit(0)
		}

		process.on('SIGINT', cleanup)
		process.on('SIGTERM', cleanup)

		return () => {
			process.off('SIGINT', cleanup)
			process.off('SIGTERM', cleanup)
		}
	}, [serverProcess])

	if (state === 'deps-check') {
		return <DepsCheck onComplete={handleDepsComplete} />
	}

	if (state === 'starting') {
		return (
			<Box>
				<Text>
					<Spinner type="dots" /> Starting Klaude server on port {port}...
				</Text>
			</Box>
		)
	}

	if (state === 'error') {
		return (
			<Box>
				<Text color="red">✗ {error}</Text>
			</Box>
		)
	}

	return <Running serverUrl={serverUrl} terminalHost={terminalHost} />
}

render(<App />)
