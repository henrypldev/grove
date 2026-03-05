#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Box, render, Text } from 'ink'
import Spinner from 'ink-spinner'
import { useEffect, useState } from 'react'
import { setLogsEnabled, startServer } from '../server/index'
import { isRunning, stopAll } from './cleanup.js'
import { DepsCheck } from './components/DepsCheck.js'
import { Running } from './components/Running.js'
import { loadPid, savePid } from './config.js'
import { runCommand } from './run.js'
import {
	getTailscaleInfo,
	SERVE_PATH,
	startServe,
	stopServe,
} from './tunnel.js'

interface ParsedArgs {
	port?: number
	background: boolean
	daemon: boolean
	stop: boolean
	help: boolean
	logs: boolean
	start: boolean
	doctor: boolean
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
	const logs = args.includes('logs')
	const start = args.includes('start')
	const doctor = args.includes('doctor') || args.includes('--doctor')

	let run: string | undefined
	const runIndex = args.indexOf('run')
	if (runIndex !== -1 && args[runIndex + 1]) {
		run = args.slice(runIndex + 1).join(' ')
	}

	return { port, background, daemon, stop, help, logs, start, doctor, run }
}

function printHelp() {
	console.log(`
grove - Mobile terminal server for Claude Code

Usage: grove <command> [options]

Commands:
  start               Start the grove server
  stop                Stop background server and kill all sessions
  run <command>       Run a CLI agent (e.g., grove run claude) with mobile access
  logs                Tail the server log file
  doctor              Check that all dependencies are installed

Options:
  -b, --background    Start server in background and free terminal
  -h, --help          Show this help message
  --port <number>     Set server port (default: random available port)
`)
}

async function runDaemon(port: number) {
	const info = getTailscaleInfo()
	if (!info) {
		console.error('Could not get Tailscale info')
		process.exit(1)
	}

	const actualPort = await startServer(port)
	savePid(process.pid)

	const success = startServe(actualPort)
	if (!success) {
		console.error('Failed to start Tailscale Serve')
		process.exit(1)
	}

	process.on('SIGINT', () => {
		stopServe()
		process.exit(0)
	})
	process.on('SIGTERM', () => {
		stopServe()
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

			setServerUrl(`https://${info.hostname}${SERVE_PATH}`)
			setTerminalHost(info.ip)
			setState('running')
		} else {
			try {
				setLogsEnabled(false)
				const actualPort = await startServer(port)
				savePid(process.pid)

				const success = startServe(actualPort)
				if (!success) {
					setError('Failed to start Tailscale Serve')
					setState('error')
					return
				}

				setServerUrl(`https://${info.hostname}${SERVE_PATH}`)
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
			stopServe()
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
					<Spinner type="dots" /> Starting grove server...
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

if (args.logs) {
	const logFile = join(homedir(), '.config', 'grove', 'server.log')
	const proc = spawn('tail', ['-f', logFile], { stdio: 'inherit' })
	process.on('SIGINT', () => {
		proc.kill()
		process.exit(0)
	})
} else if (args.doctor) {
	const { checkDependencies, isTailscaleRunning, DEPENDENCIES } =
		await import('./deps.js')
	const { found, missing } = checkDependencies()
	const foundSet = new Set(found.map(d => d.name))
	for (const dep of DEPENDENCIES) {
		if (foundSet.has(dep.name)) {
			console.log(`✓ ${dep.name}`)
		} else {
			const hint =
				dep.installHint ??
				(dep.isCask
					? `brew install --cask ${dep.brewPackage}`
					: `brew install ${dep.brewPackage}`)
			console.log(`✗ ${dep.name} — install with: ${hint}`)
		}
	}
	if (isTailscaleRunning()) {
		console.log('✓ tailscale running')
	} else {
		console.log('✗ tailscale not running')
	}
	process.exit(missing.length > 0 ? 1 : 0)
} else if (args.run) {
	runCommand(args.run)
} else if (args.stop) {
	const result = stopAll()
	console.log(result.stopped ? `✓ ${result.message}` : `✗ ${result.message}`)
	process.exit(result.stopped ? 0 : 1)
} else if (args.daemon) {
	const port = args.port ?? 0
	runDaemon(port)
} else if (args.start) {
	if (isRunning()) {
		const pid = loadPid()
		console.log(`✗ grove is already running in background (PID: ${pid})`)
		console.log('  Run "grove stop" to stop it first')
		process.exit(1)
	}

	const port = args.port ?? 0

	render(<App background={args.background} port={port} />)
} else {
	printHelp()
	process.exit(0)
}
