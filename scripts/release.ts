#!/usr/bin/env bun

import { createHash } from 'node:crypto'
import { $ } from 'bun'

const VALID_BUMPS = ['patch', 'minor', 'major'] as const
type Bump = (typeof VALID_BUMPS)[number]

const TARGETS = ['darwin-arm64', 'darwin-x64'] as const
const HOMEBREW_TAP_PATH = '../homebrew-grove'

function bumpVersion(current: string, bump: Bump): string {
	const [major, minor, patch] = current.split('.').map(Number)
	switch (bump) {
		case 'major':
			return `${major + 1}.0.0`
		case 'minor':
			return `${major}.${minor + 1}.0`
		case 'patch':
			return `${major}.${minor}.${patch + 1}`
	}
}

async function updatePackageJson(path: string, version: string) {
	const file = Bun.file(path)
	const pkg = await file.json()
	pkg.version = version
	await Bun.write(file, `${JSON.stringify(pkg, null, '\t')}\n`)
}

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

	for (const target of TARGETS) {
		const outputName = `grove-${version}-${target}`
		const outputPath = `${distDir}/${outputName}`

		console.log(`Compiling for ${target}...`)
		await $`bun build --compile --minify --target=bun-${target} cli/src/index.tsx --outfile=${outputPath}`

		const tarName = `${outputName}.tar.gz`
		const tarPath = `${distDir}/${tarName}`
		await $`tar -czf ${tarPath} -C ${distDir} ${outputName}`

		checksums[target] = await sha256(tarPath)
		artifacts.push(tarPath)
		console.log(`  Created ${tarName}`)
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
  homepage "https://github.com/henrypl/grove"
  version "${version}"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/henrypl/grove/releases/download/v#{version}/grove-#{version}-darwin-arm64.tar.gz"
      sha256 "${checksums['darwin-arm64']}"

      def install
        bin.install "grove-#{version}-darwin-arm64" => "grove"
      end
    end

    on_intel do
      url "https://github.com/henrypl/grove/releases/download/v#{version}/grove-#{version}-darwin-x64.tar.gz"
      sha256 "${checksums['darwin-x64']}"

      def install
        bin.install "grove-#{version}-darwin-x64" => "grove"
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
	const bump = process.argv[2] as Bump | undefined

	if (!bump || !VALID_BUMPS.includes(bump)) {
		console.error('Usage: bun scripts/release-server.ts <patch|minor|major>')
		process.exit(1)
	}

	const serverPkg = await Bun.file('server/package.json').json()
	const currentVersion = serverPkg.version
	const newVersion = bumpVersion(currentVersion, bump)
	const tag = `v${newVersion}`

	console.log(`Bumping version: ${currentVersion} → ${newVersion}`)

	await updatePackageJson('server/package.json', newVersion)
	await updatePackageJson('cli/package.json', newVersion)
	console.log('Updated server/package.json and cli/package.json')

	console.log('\nCompiling binaries...')
	const { artifacts, checksums } = await compileBinaries(newVersion)

	console.log('\nSHA256 checksums:')
	for (const [target, hash] of Object.entries(checksums)) {
		console.log(`  ${target}: ${hash}`)
	}

	await $`git add server/package.json cli/package.json`
	await $`git commit -m "chore: release ${tag}"`
	console.log('\nCommitted version bump')

	await $`git tag ${tag}`
	console.log(`Created tag ${tag}`)

	await $`git push origin main --tags`
	console.log('Pushed to origin')

	await $`gh release create ${tag} --generate-notes ${artifacts}`
	console.log(`Created GitHub release ${tag} with binaries`)

	await $`rm -rf dist`
	console.log('Cleaned up dist/')

	console.log('\nUpdating Homebrew tap...')
	await updateHomebrewFormula(newVersion, checksums)

	console.log('\n✓ Release complete!')
	console.log(
		`\nUsers can install with: brew tap henrypl/grove && brew install grove`,
	)
}

run()
