#!/usr/bin/env bun
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'))

let output = `import type { MigrationMeta } from 'drizzle-orm/migrator'

// Auto-generated from drizzle/ migration files.
// Run 'bun scripts/embed-migrations.ts' to regenerate after adding new migrations.
export const migrations: MigrationMeta[] = [\n`

for (const entry of journal.entries) {
	const sql = readFileSync(`drizzle/${entry.tag}.sql`, 'utf8')
	const hash = createHash('sha256').update(sql).digest('hex')
	const statements = sql.split('--> statement-breakpoint')

	output += `\t{\n`
	output += `\t\tsql: [\n`
	for (const stmt of statements) {
		output += `\t\t\t${JSON.stringify(stmt)},\n`
	}
	output += `\t\t],\n`
	output += `\t\tfolderMillis: ${entry.when},\n`
	output += `\t\thash: '${hash}',\n`
	output += `\t\tbps: ${entry.breakpoints},\n`
	output += `\t},\n`
}

output += `]\n`

writeFileSync('src/server/db/migrations.ts', output)
console.log(
	`Embedded ${journal.entries.length} migrations into src/server/db/migrations.ts`,
)
