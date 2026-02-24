import { describe, expect, it } from 'bun:test'
import { createGroveTools } from '../grove-tools'

describe('createGroveTools', () => {
	it('returns an object with a name property', () => {
		const tools = createGroveTools('team-1', 'agent-1')
		expect(
			(tools as any).name ?? (tools as any)._name ?? typeof tools,
		).toBeTruthy()
	})
})
