import { Box, Text } from 'ink'
import SelectInput from 'ink-select-input'
import Spinner from 'ink-spinner'
import { useEffect, useState } from 'react'
import {
	checkDependencies,
	type Dependency,
	hasHomebrew,
	installDependency,
	isTailscaleRunning,
	openTailscaleApp,
} from '../deps.js'

interface Props {
	onComplete: () => void
}

type Step =
	| 'checking'
	| 'show-results'
	| 'ask-install'
	| 'installing'
	| 'ask-tailscale'
	| 'waiting-tailscale'
	| 'done'
	| 'error'

export function DepsCheck({ onComplete }: Props) {
	const [step, setStep] = useState<Step>('checking')
	const [found, setFound] = useState<Dependency[]>([])
	const [missing, setMissing] = useState<Dependency[]>([])
	const [installing, setInstalling] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		const result = checkDependencies()
		setFound(result.found)
		setMissing(result.missing)
		setStep('show-results')
	}, [])

	useEffect(() => {
		if (step === 'show-results') {
			if (missing.length === 0) {
				if (!isTailscaleRunning()) {
					setStep('ask-tailscale')
				} else {
					setStep('done')
				}
			} else {
				setStep('ask-install')
			}
		}
	}, [step, missing.length])

	useEffect(() => {
		if (step === 'done') {
			onComplete()
		}
	}, [step, onComplete])

	const handleInstallChoice = (item: { value: string }) => {
		if (item.value === 'yes') {
			if (!hasHomebrew()) {
				setError('Homebrew is required. Install from https://brew.sh')
				setStep('error')
				return
			}
			setStep('installing')
			installMissing()
		} else {
			console.log('\nInstall manually:')
			for (const dep of missing) {
				const cmd = dep.isCask
					? `brew install --cask ${dep.brewPackage}`
					: `brew install ${dep.brewPackage}`
				console.log(`  ${cmd}`)
			}
			process.exit(1)
		}
	}

	const installMissing = async () => {
		for (const dep of missing) {
			setInstalling(dep.name)
			const success = installDependency(dep)
			if (!success) {
				setError(`Failed to install ${dep.name}`)
				setStep('error')
				return
			}
		}
		setInstalling(null)
		setMissing([])
		if (!isTailscaleRunning()) {
			setStep('ask-tailscale')
		} else {
			setStep('done')
		}
	}

	const handleTailscaleChoice = (item: { value: string }) => {
		if (item.value === 'yes') {
			openTailscaleApp()
			setStep('waiting-tailscale')
		} else {
			setError('Tailscale must be running. Start it and try again.')
			setStep('error')
		}
	}

	useEffect(() => {
		if (step === 'waiting-tailscale') {
			const interval = setInterval(() => {
				if (isTailscaleRunning()) {
					clearInterval(interval)
					setStep('done')
				}
			}, 1000)
			return () => clearInterval(interval)
		}
	}, [step])

	if (step === 'checking') {
		return (
			<Box>
				<Text>
					<Spinner type="dots" /> Checking dependencies...
				</Text>
			</Box>
		)
	}

	if (step === 'error') {
		return (
			<Box>
				<Text color="red">✗ {error}</Text>
			</Box>
		)
	}

	if (step === 'installing') {
		return (
			<Box flexDirection="column">
				<Text>
					<Spinner type="dots" /> Installing {installing}...
				</Text>
			</Box>
		)
	}

	if (step === 'ask-install') {
		return (
			<Box flexDirection="column">
				<Text>Checking dependencies...</Text>
				{found.map(dep => (
					<Text key={dep.name} color="green">
						✓ {dep.name} found
					</Text>
				))}
				{missing.map(dep => (
					<Text key={dep.name} color="red">
						✗ {dep.name} not found
					</Text>
				))}
				<Box marginTop={1}>
					<Text>Install missing dependencies?</Text>
				</Box>
				<SelectInput
					items={[
						{
							label: `Yes, install ${missing.map(d => d.name).join(' and ')}`,
							value: 'yes',
						},
						{ label: 'No, show me the commands', value: 'no' },
					]}
					onSelect={handleInstallChoice}
				/>
			</Box>
		)
	}

	if (step === 'ask-tailscale') {
		return (
			<Box flexDirection="column">
				<Text>Checking dependencies...</Text>
				{found.map(dep => (
					<Text key={dep.name} color="green">
						✓ {dep.name} found
					</Text>
				))}
				<Box marginTop={1}>
					<Text color="yellow">Tailscale is not running.</Text>
				</Box>
				<Text>Open Tailscale app now?</Text>
				<SelectInput
					items={[
						{ label: 'Yes', value: 'yes' },
						{ label: "No, I'll do it myself", value: 'no' },
					]}
					onSelect={handleTailscaleChoice}
				/>
			</Box>
		)
	}

	if (step === 'waiting-tailscale') {
		return (
			<Box flexDirection="column">
				<Text>
					<Spinner type="dots" /> Waiting for Tailscale to start...
				</Text>
			</Box>
		)
	}

	return (
		<Box flexDirection="column">
			<Text>Checking dependencies...</Text>
			{found.map(dep => (
				<Text key={dep.name} color="green">
					✓ {dep.name} found
				</Text>
			))}
		</Box>
	)
}
