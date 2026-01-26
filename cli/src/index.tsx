#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Box, render, Text } from 'ink'
import Spinner from 'ink-spinner'
import { useEffect, useState } from 'react'
import { isRunning, stopAll } from './cleanup.js'
import { DepsCheck } from './components/DepsCheck.js'
import { Running } from './components/Running.js'
import { loadConfig, loadPid, saveConfig, savePid } from './config.js'
import { getTailscaleInfo, startFunnel, stopFunnel } from './tunnel.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER_PATH = join(__dirname, '../../server/src/index.ts')

interface ParsedArgs {
	port?: number
	background: boolean
	stop: boolean
	help: boolean
}

function parseArgs(): ParsedArgs {
	const args = process.argv.slice(2)
	const portIndex = args.indexOf('--port')
	const port =
		portIndex !== -1 && args[portIndex + 1]
			? parseInt(args[portIndex + 1], 10)
			: undefined
	const background = args.includes('--background') || args.includes('-b')
	const stop = args.includes('--stop') || args.includes('stop')
	const help = args.includes('--help') || args.includes('-h')
	return { port, background, stop, help }
}

function printHelp() {
	console.log(`
grove - Mobile terminal server for Claude Code

Usage: grove [options]

Options:
  -b, --background    Start server in background and free terminal
  -h, --help          Show this help message
  --port <number>     Set server port (default: 3000)
  --stop, stop        Stop background server and kill all sessions
`)
}

type AppState = 'deps-check' | 'starting' | 'running' | 'error'

interface AppProps {
	background: boolean
	port: number
}

function App({ background, port }: AppProps) {
	const [state, setState] = useState<AppState>('deps-check')
	const [error, setError] = useState<string | null>(null)
	const [serverUrl, setServerUrl] = useState<string>('')
	const [terminalHost, setTerminalHost] = useState<string>('')
	const [serverProcess, setServerProcess] = useState<ReturnType<
		typeof spawn
	> | null>(null)

	const args = parseArgs()
	const config = loadConfig()

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
			detached: background,
		})

		proc.on('error', err => {
			setError(`Failed to start server: ${err.message}`)
			setState('error')
		})

		if (background && proc.pid) {
			proc.unref()
			savePid(proc.pid)
		}

		setServerProcess(proc)

		setTimeout(() => {
			const success = startFunnel(port)
			if (!success) {
				setError('Failed to start Tailscale Funnel')
				proc.kill()
				setState('error')
				return
			}

			setServerUrl(`https://${info.hostname}/grove`)
			setTerminalHost(info.ip)
			setState('running')
		}, 1000)
	}

	useEffect(() => {
		if (background) return

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
	}, [serverProcess, background])

	if (state === 'deps-check') {
		return <DepsCheck onComplete={handleDepsComplete} />
	}

	if (state === 'starting') {
		return (
			<Box>
				<Text>
					<Spinner type="dots" /> Starting grove server on port {port}...
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

	if (background) {
		return (
			<Running
				serverUrl={serverUrl}
				terminalHost={terminalHost}
				background
				pid={serverProcess?.pid}
			/>
		)
	}

	return <Running serverUrl={serverUrl} terminalHost={terminalHost} />
}

const args = parseArgs()

if (args.help) {
	printHelp()
	process.exit(0)
}

if (args.stop) {
	const result = stopAll()
	console.log(result.stopped ? `✓ ${result.message}` : `✗ ${result.message}`)
	process.exit(result.stopped ? 0 : 1)
}

if (isRunning()) {
	const pid = loadPid()
	console.log(`✗ grove is already running in background (PID: ${pid})`)
	console.log('  Run "grove --stop" to stop it first')
	process.exit(1)
}

const config = loadConfig()
const port = args.port ?? config.port

render(<App background={args.background} port={port} />)
