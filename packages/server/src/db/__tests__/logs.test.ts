import { describe, expect, test } from 'bun:test'
import {
	clearTeamLogs,
	dbGetLatestLogByType,
	dbListLogsSince,
	emitTeamLog,
	subscribeToTeamLogs,
} from '../logs'

describe('db/logs', () => {
	test('emitTeamLog returns log with id and type', () => {
		const log = emitTeamLog('t1', 'build:start', { step: 1 })
		expect(log.teamId).toBe('t1')
		expect(log.type).toBe('build:start')
		expect(typeof log.id).toBe('number')
		expect(JSON.parse(log.payload)).toEqual({ step: 1 })
	})

	test('subscribeToTeamLogs receives emitted logs', () => {
		const received: unknown[] = []
		const unsub = subscribeToTeamLogs('t2', log => received.push(log))
		emitTeamLog('t2', 'test', { x: 1 })
		expect(received).toHaveLength(1)
		unsub()
		emitTeamLog('t2', 'test', { x: 2 })
		expect(received).toHaveLength(1)
	})

	test('dbListLogsSince filters by time', async () => {
		const teamId = 't3'
		emitTeamLog(teamId, 'early', {})
		await Bun.sleep(10)
		const mid = Date.now()
		await Bun.sleep(10)
		emitTeamLog(teamId, 'late', {})
		const logs = dbListLogsSince(teamId, mid)
		expect(logs).toHaveLength(1)
		expect(logs[0].type).toBe('late')
	})

	test('dbGetLatestLogByType returns most recent match', () => {
		const teamId = 't4'
		emitTeamLog(teamId, 'setup', { v: 1 })
		emitTeamLog(teamId, 'other', {})
		emitTeamLog(teamId, 'setup', { v: 2 })
		const latest = dbGetLatestLogByType(teamId, 'setup')
		expect(latest).not.toBeNull()
		expect(JSON.parse(latest!.payload)).toEqual({ v: 2 })
	})

	test('dbGetLatestLogByType returns null when no match', () => {
		expect(dbGetLatestLogByType('t5', 'nonexistent')).toBeNull()
	})

	test('clearTeamLogs removes all logs for team', () => {
		const teamId = 't6'
		emitTeamLog(teamId, 'x', {})
		clearTeamLogs(teamId)
		expect(dbListLogsSince(teamId, 0)).toHaveLength(0)
	})
})
