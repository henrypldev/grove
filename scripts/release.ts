#!/usr/bin/env bun

import { createHash } from 'node:crypto'
import { $ } from 'bun'

const TARGETS = ['darwin-arm64', 'darwin-x64'] as const
const HOMEBREW_TAP_PATH = '../homebrew-grove'

async function sha256(filePath: string): Promise<string> {
	const file = Bun.file(filePath)
	const buffer = await file.arrayBuffer()
	return createHash('sha256').update(Buffer.from(buffer)).digest('hex')
}

async function compileBinaries(
	version: string,
): Promise<{ artifacts: string[]; checksums: Record<string, string> }> {
	const artifacts: string[] = []
	const checksums: Record<string, string> = {}
	const distDir = 'dist'

	await $`mkdir -p ${distDir}`

	console.log('Building GroveSimulatorServer...')
	await $`cd simulator-server && swift build -c release`

	const results = await Promise.all(
		TARGETS.map(async target => {
			const outputName = `grove-${version}-${target}`
			const stageDir = `${distDir}/${outputName}`

			console.log(`Compiling for ${target}...`)
			await $`mkdir -p ${stageDir}`
			await $`bun build --compile --minify --target=bun-${target} src/cli/index.tsx --outfile=${stageDir}/grove`
			await $`cp simulator-server/.build/release/GroveSimulatorServer ${stageDir}/GroveSimulatorServer`

			const tarName = `${outputName}.tar.gz`
			const tarPath = `${distDir}/${tarName}`
			await $`tar -czf ${tarPath} -C ${distDir} ${outputName}`

			const checksum = await sha256(tarPath)
			console.log(`  Created ${tarName}`)

			await $`rm -rf ${stageDir}`
			return { target, tarPath, checksum }
		}),
	)

	for (const { target, tarPath, checksum } of results) {
		checksums[target] = checksum
		artifacts.push(tarPath)
	}

	return { artifacts, checksums }
}

async function updateHomebrewFormula(
	version: string,
	checksums: Record<string, string>,
) {
	const formulaPath = `${HOMEBREW_TAP_PATH}/Formula/grove.rb`
	const file = Bun.file(formulaPath)

	if (!(await file.exists())) {
		console.log('  Homebrew formula not found, skipping update')
		return
	}

	const formula = `class Grove < Formula
  desc "Mobile terminal server for Claude Code - manage sessions from your phone"
  homepage "https://github.com/henrypldev/grove"
  version "${version}"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/henrypldev/grove/releases/download/v#{version}/grove-#{version}-darwin-arm64.tar.gz"
      sha256 "${checksums['darwin-arm64']}"

      def install
        bin.install "grove"
        libexec.install "GroveSimulatorServer"
      end
    end

    on_intel do
      url "https://github.com/henrypldev/grove/releases/download/v#{version}/grove-#{version}-darwin-x64.tar.gz"
      sha256 "${checksums['darwin-x64']}"

      def install
        bin.install "grove"
        libexec.install "GroveSimulatorServer"
      end
    end
  end

  test do
    assert_match "grove", shell_output("#{bin}/grove --help")
  end
end
`

	await Bun.write(formulaPath, formula)
	console.log('  Updated homebrew formula')

	await $`cd ${HOMEBREW_TAP_PATH} && git add Formula/grove.rb && git commit -m "grove ${version}" && git push`
	console.log('  Pushed homebrew-grove')
}

async function run() {
	const pkg = await Bun.file('package.json').json()
	const version = pkg.version
	const tag = `v${version}`

	console.log(`\nCompiling binaries for ${tag}...`)
	const { artifacts, checksums } = await compileBinaries(version)

	console.log('\nSHA256 checksums:')
	for (const [target, hash] of Object.entries(checksums)) {
		console.log(`  ${target}: ${hash}`)
	}

	console.log('\nUploading binaries to GitHub release...')
	await $`gh release upload ${tag} ${artifacts}`

	await $`rm -rf dist`
	console.log('Cleaned up dist/')

	console.log('\nUpdating Homebrew tap...')
	await updateHomebrewFormula(version, checksums)

	console.log('\n✓ Post-release complete!')
}

run()
