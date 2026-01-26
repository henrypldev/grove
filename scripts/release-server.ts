#!/usr/bin/env bun

import { $ } from 'bun'

const VALID_BUMPS = ['patch', 'minor', 'major'] as const
type Bump = (typeof VALID_BUMPS)[number]

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

async function run() {
	const bump = process.argv[2] as Bump | undefined

	if (!bump || !VALID_BUMPS.includes(bump)) {
		console.error('Usage: bun scripts/release-server.ts <patch|minor|major>')
		process.exit(1)
	}

	const serverPkg = await Bun.file('server/package.json').json()
	const currentVersion = serverPkg.version
	const newVersion = bumpVersion(currentVersion, bump)
	const tag = `server-v${newVersion}`

	console.log(`Bumping server/cli version: ${currentVersion} → ${newVersion}`)

	await updatePackageJson('server/package.json', newVersion)
	await updatePackageJson('cli/package.json', newVersion)
	console.log('Updated server/package.json and cli/package.json')

	await $`git add server/package.json cli/package.json`
	await $`git commit -m "chore: release ${tag}"`
	console.log('Committed version bump')

	await $`git tag ${tag}`
	console.log(`Created tag ${tag}`)

	await $`git push origin main --tags`
	console.log('Pushed to origin')

	await $`gh release create ${tag} --generate-notes`
	console.log(`Created GitHub release ${tag}`)

	console.log('\n✓ Release complete!')
}

run()
