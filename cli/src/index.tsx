#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { Box, render, Text } from 'ink'
import Spinner from 'ink-spinner'
import { useEffect, useState } from 'react'
import { setLogsEnabled, startServer } from '../../server/src/index.ts'
import { isRunning, stopAll } from './cleanup.js'
import { DepsCheck } from './components/DepsCheck.js'
import { Running } from './components/Running.js'
import { loadConfig, loadPid, saveConfig, savePid } from './config.js'
import { runCommand } from './run.js'
import { getTailscaleInfo, startFunnel, stopFunnel } from './tunnel.js'

interface ParsedArgs {
	port?: number
	background: boolean
	daemon: boolean
	stop: boolean
	help: boolean
	run?: string
}

function parseArgs(): ParsedArgs {
	const args = process.argv.slice(2)
	const portIndex = args.indexOf('--port')
	const port =
		portIndex !== -1 && args[portIndex + 1]
			? parseInt(args[portIndex + 1], 10)
			: undefined
	const background = args.includes('--background') || args.includes('-b')
	const daemon = args.includes('--_daemon')
	const stop = args.includes('--stop') || args.includes('stop')
	const help = args.includes('--help') || args.includes('-h')

	let run: string | undefined
	const runIndex = args.indexOf('run')
	if (runIndex !== -1 && args[runIndex + 1]) {
		run = args.slice(runIndex + 1).join(' ')
	}

	return { port, background, daemon, stop, help, run }
}

function printHelp() {
	console.log(`
grove - Mobile terminal server for Claude Code

Usage: grove [options]
       grove run <command>

Commands:
  run <command>       Run a CLI agent (e.g., grove run claude) with mobile access

Options:
  -b, --background    Start server in background and free terminal
  -h, --help          Show this help message
  --port <number>     Set server port (default: 3001)
  --stop, stop        Stop background server and kill all sessions
`)
}

async function runDaemon(port: number) {
	const info = getTailscaleInfo()
	if (!info) {
		console.error('Could not get Tailscale info')
		process.exit(1)
	}

	await startServer(port)
	savePid(process.pid)

	const success = startFunnel(port)
	if (!success) {
		console.error('Failed to start Tailscale Funnel')
		process.exit(1)
	}

	process.on('SIGINT', () => {
		stopFunnel()
		process.exit(0)
	})
	process.on('SIGTERM', () => {
		stopFunnel()
		process.exit(0)
	})
}

function spawnDaemon(port: number): number | null {
	const args = ['--_daemon', '--port', String(port)]
	const proc = spawn(process.execPath, [process.argv[1], ...args], {
		stdio: 'ignore',
		detached: true,
	})

	if (proc.pid) {
		proc.unref()
		return proc.pid
	}
	return null
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
	const [daemonPid, setDaemonPid] = useState<number | null>(null)

	const args = parseArgs()
	const config = loadConfig()

	useEffect(() => {
		if (args.port && args.port !== config.port) {
			saveConfig({ ...config, port: args.port })
		}
	}, [args.port, config])

	const handleDepsComplete = async () => {
		setState('starting')

		const info = getTailscaleInfo()
		if (!info) {
			setError('Could not get Tailscale info. Is Tailscale running?')
			setState('error')
			return
		}

		if (background) {
			const pid = spawnDaemon(port)
			if (!pid) {
				setError('Failed to start background server')
				setState('error')
				return
			}
			savePid(pid)
			setDaemonPid(pid)

			await new Promise(resolve => setTimeout(resolve, 1500))

			setServerUrl(`https://${info.hostname}/grove`)
			setTerminalHost(info.ip)
			setState('running')
		} else {
			try {
				setLogsEnabled(false)
				await startServer(port)
				savePid(process.pid)

				const success = startFunnel(port)
				if (!success) {
					setError('Failed to start Tailscale Funnel')
					setState('error')
					return
				}

				setServerUrl(`https://${info.hostname}/grove`)
				setTerminalHost(info.ip)
				setState('running')
			} catch (err) {
				setError(`Failed to start server: ${err}`)
				setState('error')
			}
		}
	}

	useEffect(() => {
		if (background) return

		const cleanup = () => {
			stopFunnel()
			process.exit(0)
		}

		process.on('SIGINT', cleanup)
		process.on('SIGTERM', cleanup)

		return () => {
			process.off('SIGINT', cleanup)
			process.off('SIGTERM', cleanup)
		}
	}, [background])

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
				pid={daemonPid ?? undefined}
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

if (args.run) {
	runCommand(args.run)
} else if (args.stop) {
	const result = stopAll()
	console.log(result.stopped ? `✓ ${result.message}` : `✗ ${result.message}`)
	process.exit(result.stopped ? 0 : 1)
} else if (args.daemon) {
	const config = loadConfig()
	const port = args.port ?? config.port
	runDaemon(port)
} else {
	if (isRunning()) {
		const pid = loadPid()
		console.log(`✗ grove is already running in background (PID: ${pid})`)
		console.log('  Run "grove --stop" to stop it first')
		process.exit(1)
	}

	const config = loadConfig()
	const port = args.port ?? config.port

	render(<App background={args.background} port={port} />)
}
