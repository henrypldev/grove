import { Data } from 'effect'

// Agent errors
export class AgentSpawnError extends Data.TaggedError('AgentSpawnError')<{
	teamId: string
	role: string
	cause: unknown
}> {}
export class AgentSessionError extends Data.TaggedError('AgentSessionError')<{
	agentId: string
	teamId: string
	role: string
	subtype: string
}> {}
export class AgentRetryExhausted extends Data.TaggedError(
	'AgentRetryExhausted',
)<{
	agentId: string
	teamId: string
	retryCount: number
}> {}

// Git errors
export class WorktreeCreateError extends Data.TaggedError(
	'WorktreeCreateError',
)<{
	teamId: string
	branch: string
	stderr: string
}> {}
export class MergeConflictError extends Data.TaggedError('MergeConflictError')<{
	teamId: string
	taskId: string
	stderr: string
}> {}
export class GitOperationError extends Data.TaggedError('GitOperationError')<{
	operation: string
	teamId: string
	stderr: string
	exitCode: number
}> {}

// Dispatch errors
export class DispatchError extends Data.TaggedError('DispatchError')<{
	teamId: string
	targetRole: string
	reason: string
}> {}
export class TaskDevLimitError extends Data.TaggedError('TaskDevLimitError')<{
	teamId: string
	taskId: string
	activeCount: number
	maxCount: number
}> {}
