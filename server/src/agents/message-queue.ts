import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

export class MessageQueue implements AsyncIterable<SDKUserMessage> {
	private buffer: SDKUserMessage[] = []
	private resolve: ((value: IteratorResult<SDKUserMessage>) => void) | null =
		null
	closed = false
	sessionId = ''

	push(text: string) {
		const msg: SDKUserMessage = {
			type: 'user',
			message: { role: 'user', content: text },
			parent_tool_use_id: null,
			session_id: this.sessionId,
		}
		if (this.resolve) {
			const r = this.resolve
			this.resolve = null
			r({ value: msg, done: false })
		} else {
			this.buffer.push(msg)
		}
	}

	pushContent(content: SDKUserMessage['message']['content']) {
		const msg: SDKUserMessage = {
			type: 'user',
			message: { role: 'user', content },
			parent_tool_use_id: null,
			session_id: this.sessionId,
		}
		if (this.resolve) {
			const r = this.resolve
			this.resolve = null
			r({ value: msg, done: false })
		} else {
			this.buffer.push(msg)
		}
	}

	close() {
		this.closed = true
		if (this.resolve) {
			const r = this.resolve
			this.resolve = null
			r({ value: undefined as unknown as SDKUserMessage, done: true })
		}
	}

	[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
		return {
			next: () => {
				if (this.buffer.length > 0) {
					return Promise.resolve({ value: this.buffer.shift()!, done: false })
				}
				if (this.closed) {
					return Promise.resolve({
						value: undefined as unknown as SDKUserMessage,
						done: true,
					})
				}
				return new Promise<IteratorResult<SDKUserMessage>>(r => {
					this.resolve = r
				})
			},
		}
	}
}
