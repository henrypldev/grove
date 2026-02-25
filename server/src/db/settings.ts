import { eq } from 'drizzle-orm'
import { getDb } from './index'
import { settings } from './schema'

export function dbGetSetting(key: string): string | null {
	const row = getDb().select().from(settings).where(eq(settings.key, key)).get()
	return row?.value ?? null
}

export function dbSetSetting(key: string, value: string): void {
	getDb()
		.insert(settings)
		.values({ key, value })
		.onConflictDoUpdate({ target: settings.key, set: { value } })
		.run()
}

export function dbGetAllSettings(): Record<string, string> {
	const rows = getDb().select().from(settings).all()
	const result: Record<string, string> = {}
	for (const row of rows) {
		result[row.key] = row.value
	}
	return result
}
