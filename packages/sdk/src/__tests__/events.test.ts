import { describe, expect, test } from 'bun:test'
import { TypedEmitter } from '../events'

type TestEvents = {
	message: (text: string) => void
	count: (n: number) => void
}

// Subclass to expose protected emit
class TestEmitter extends TypedEmitter<TestEvents> {
	public doEmit<K extends keyof TestEvents>(event: K, ...args: Parameters<TestEvents[K]>): void {
		this.emit(event, ...args)
	}
}

describe('TypedEmitter', () => {
	test('on registers listener and receives events', () => {
		const emitter = new TestEmitter()
		const received: string[] = []
		emitter.on('message', text => received.push(text))
		emitter.doEmit('message', 'hello')
		expect(received).toEqual(['hello'])
	})

	test('on returns unsubscriber', () => {
		const emitter = new TestEmitter()
		const received: string[] = []
		const unsub = emitter.on('message', text => received.push(text))
		emitter.doEmit('message', 'a')
		unsub()
		emitter.doEmit('message', 'b')
		expect(received).toEqual(['a'])
	})

	test('multiple listeners for same event', () => {
		const emitter = new TestEmitter()
		const a: string[] = []
		const b: string[] = []
		emitter.on('message', text => a.push(text))
		emitter.on('message', text => b.push(text))
		emitter.doEmit('message', 'x')
		expect(a).toEqual(['x'])
		expect(b).toEqual(['x'])
	})

	test('emit with no listeners does nothing', () => {
		const emitter = new TestEmitter()
		expect(() => emitter.doEmit('message', 'test')).not.toThrow()
	})

	test('removeAllListeners for specific event', () => {
		const emitter = new TestEmitter()
		const msgs: string[] = []
		const nums: number[] = []
		emitter.on('message', text => msgs.push(text))
		emitter.on('count', n => nums.push(n))
		emitter.removeAllListeners('message')
		emitter.doEmit('message', 'gone')
		emitter.doEmit('count', 42)
		expect(msgs).toEqual([])
		expect(nums).toEqual([42])
	})

	test('removeAllListeners clears all events', () => {
		const emitter = new TestEmitter()
		const msgs: string[] = []
		emitter.on('message', text => msgs.push(text))
		emitter.on('count', () => {})
		emitter.removeAllListeners()
		emitter.doEmit('message', 'gone')
		expect(msgs).toEqual([])
	})
})
