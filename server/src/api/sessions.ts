import {
	generateId,
	getTerminalHost,
	loadConfig,
	loadSessions,
	log,
	type SessionData,
	saveConfig,
} from '../config'
import {
	getSessionState,
	isSessionActive,
	type SessionState,
	startSession,
	stopSession,
} from '../terminal/ttyd'
import { getWorktrees } from './worktrees'

export type SessionWithStatus = Omit<SessionData, 'pid'> & {
	isActive: boolean
	state: SessionState
}

const sseClients = new Set<ReadableStreamDefaultController>()
const previousStates = new Map<string, SessionState>()
let stateInterval: ReturnType<typeof setInterval> | null = null

function startStatePolling() {
	if (stateInterval) return
	stateInterval = setInterval(() => {
		if (sseClients.size > 0) {
			broadcastSessions()
		}
	}, 2000)
}

function stopStatePolling() {
	if (stateInterval) {
		clearInterval(stateInterval)
		stateInterval = null
	}
}

export function addSSEClient(controller: ReadableStreamDefaultController) {
	sseClients.add(controller)
	startStatePolling()
}

export function removeSSEClient(controller: ReadableStreamDefaultController) {
	sseClients.delete(controller)
	if (sseClients.size === 0) {
		stopStatePolling()
	}
}

function broadcastSSE(data: string) {
	const encoded = new TextEncoder().encode(data)
	for (const controller of sseClients) {
		try {
			controller.enqueue(encoded)
		} catch {
			sseClients.delete(controller)
		}
	}
}

async function fireWebhook(payload: object) {
	const config = await loadConfig()
	if (!config.webhookUrl) return
	try {
		await fetch(config.webhookUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		})
	} catch (err) {
		log('webhook', 'failed to send', { error: String(err) })
	}
}

export async function broadcastSessions() {
	const sessions = await getSessions()

	for (const session of sessions) {
		const prev = previousStates.get(session.id)
		if (prev === 'busy' && session.state === 'waiting') {
			const payload = {
				type: 'state_change',
				session: {
					id: session.id,
					repoName: session.repoName,
					branch: session.branch,
				},
				from: 'busy',
				to: 'waiting',
			}
			broadcastSSE(`data: ${JSON.stringify(payload)}\n\n`)
			fireWebhook(payload)
		}
		previousStates.set(session.id, session.state)
	}

	broadcastSSE(`data: ${JSON.stringify({ type: 'sessions', sessions })}\n\n`)
}

export async function setWebhookUrl(url: string) {
	const config = await loadConfig()
	config.webhookUrl = url
	await saveConfig(config)
}

export async function removeWebhookUrl() {
	const config = await loadConfig()
	delete config.webhookUrl
	await saveConfig(config)
}

export async function getWebhookUrl(): Promise<string | undefined> {
	const config = await loadConfig()
	return config.webhookUrl
}

export async function getSessions(): Promise<SessionWithStatus[]> {
	log('sessions', 'getting sessions')
	const sessionsState = await loadSessions()
	const terminalHost = await getTerminalHost()
	log('sessions', 'found sessions', { count: sessionsState.sessions.length })
	const sessions = await Promise.all(
		sessionsState.sessions.map(async ({ pid, ...rest }) => {
			const isActive = await isSessionActive(pid)
			return {
				...rest,
				terminalUrl: rest.terminalUrl || `https://${terminalHost}:${rest.port}`,
				isActive,
				state: isActive
					? await getSessionState(rest.id)
					: ('idle' as SessionState),
			}
		}),
	)
	return sessions
}

export async function createSession(
	repoId: string,
	worktreeBranch: string,
	skipPermissions?: boolean,
): Promise<SessionData | string> {
	log('sessions', 'creating session', { repoId, worktreeBranch })
	const config = await loadConfig()
	const repo = config.repos.find(r => r.id === repoId)
	if (!repo) {
		log('sessions', 'repo not found', { repoId })
		return `Repo not found: ${repoId}`
	}

	const worktrees = await getWorktrees(repoId)
	const worktree = worktrees.find(w => w.branch === worktreeBranch)
	if (!worktree) {
		log('sessions', 'worktree not found', { worktreeBranch })
		return `Worktree not found: ${worktreeBranch}`
	}

	const terminalHost = await getTerminalHost()
	const session: SessionData = {
		id: generateId(),
		repoId,
		repoName: repo.name,
		worktree: worktree.path,
		branch: worktree.branch,
		port: 0,
		terminalUrl: '',
		pid: 0,
		createdAt: new Date().toISOString(),
		skipPermissions,
	}

	log('sessions', 'starting session', { id: session.id })
	const started = await startSession(session)
	if (!started) {
		log('sessions', 'failed to start session', { id: session.id })
		return 'Failed to start terminal session'
	}

	session.terminalUrl = `https://${terminalHost}:${session.port}`
	log('sessions', 'session created', { id: session.id, port: session.port })
	broadcastSessions()
	return session
}

export async function deleteSession(id: string): Promise<boolean> {
	log('sessions', 'deleting session', { id })
	const result = await stopSession(id)
	if (result) broadcastSessions()
	return result
}

export async function getBehindMain(
	sessionId: string,
): Promise<number | string> {
	const sessionsState = await loadSessions()
	const session = sessionsState.sessions.find(s => s.id === sessionId)
	if (!session) return `Session not found: ${sessionId}`

	const config = await loadConfig()
	const repo = config.repos.find(r => r.id === session.repoId)
	if (!repo) return 'Repo not found for session'

	await Bun.$`git -C ${repo.path} fetch origin`.quiet().nothrow()

	const mainBranch =
		await Bun.$`git -C ${repo.path} symbolic-ref refs/remotes/origin/HEAD`
			.quiet()
			.nothrow()
	const mainRef =
		mainBranch.exitCode === 0
			? mainBranch.stdout.toString().trim().replace('refs/remotes/', '')
			: 'origin/main'

	const result =
		await Bun.$`git -C ${repo.path} rev-list ${session.branch}..${mainRef} --count`
			.quiet()
			.nothrow()

	if (result.exitCode !== 0) return 'Failed to count commits behind main'
	return parseInt(result.stdout.toString().trim(), 10)
}

export async function mergeMain(
	sessionId: string,
	strategy: 'merge' | 'rebase',
): Promise<{ success: boolean; error?: string }> {
	const sessionsState = await loadSessions()
	const session = sessionsState.sessions.find(s => s.id === sessionId)
	if (!session) return { success: false, error: 'Session not found' }

	const config = await loadConfig()
	const repo = config.repos.find(r => r.id === session.repoId)
	if (!repo) return { success: false, error: 'Repo not found' }

	const mainBranch =
		await Bun.$`git -C ${repo.path} symbolic-ref refs/remotes/origin/HEAD`
			.quiet()
			.nothrow()
	const mainRef =
		mainBranch.exitCode === 0
			? mainBranch.stdout.toString().trim().replace('refs/remotes/', '')
			: 'origin/main'

	await Bun.$`git -C ${session.worktree} fetch origin`.quiet().nothrow()

	const result =
		strategy === 'rebase'
			? await Bun.$`git -C ${session.worktree} rebase ${mainRef}`
					.quiet()
					.nothrow()
			: await Bun.$`git -C ${session.worktree} merge ${mainRef}`
					.quiet()
					.nothrow()

	if (result.exitCode !== 0) {
		const stderr = result.stderr.toString().trim()
		if (strategy === 'rebase') {
			await Bun.$`git -C ${session.worktree} rebase --abort`.quiet().nothrow()
		} else {
			await Bun.$`git -C ${session.worktree} merge --abort`.quiet().nothrow()
		}
		return { success: false, error: stderr }
	}

	return { success: true }
}

export async function createPR(
	sessionId: string,
): Promise<{ success: boolean; url?: string; error?: string }> {
	const sessionsState = await loadSessions()
	const session = sessionsState.sessions.find(s => s.id === sessionId)
	if (!session) return { success: false, error: 'Session not found' }

	const config = await loadConfig()
	const repo = config.repos.find(r => r.id === session.repoId)
	if (!repo) return { success: false, error: 'Repo not found' }

	const push =
		await Bun.$`git -C ${session.worktree} push -u origin ${session.branch}`
			.quiet()
			.nothrow()
	if (push.exitCode !== 0) {
		return { success: false, error: push.stderr.toString().trim() }
	}

	const existingPR = await Bun.$`gh pr view ${session.branch} --json url`
		.cwd(session.worktree)
		.quiet()
		.nothrow()
	if (existingPR.exitCode === 0) {
		const pr = JSON.parse(existingPR.stdout.toString().trim())
		return { success: true, url: pr.url }
	}

	const remoteUrl =
		await Bun.$`git -C ${session.worktree} remote get-url origin`
			.quiet()
			.nothrow()
	if (remoteUrl.exitCode !== 0) {
		return { success: false, error: 'Could not determine remote URL' }
	}
	const raw = remoteUrl.stdout.toString().trim()
	const match = raw.match(/github\.com[:/](.+?)(?:\.git)?$/)
	if (!match) return { success: false, error: 'Not a GitHub repository' }
	const ownerRepo = match[1]

	const mainBranch =
		await Bun.$`git -C ${repo.path} symbolic-ref refs/remotes/origin/HEAD`
			.quiet()
			.nothrow()
	const baseBranch =
		mainBranch.exitCode === 0
			? mainBranch.stdout.toString().trim().replace('refs/remotes/origin/', '')
			: 'main'

	const logResult =
		await Bun.$`git -C ${session.worktree} log ${baseBranch}..${session.branch} --pretty=format:%s`
			.quiet()
			.nothrow()
	const commits =
		logResult.exitCode === 0
			? logResult.stdout.toString().trim().split('\n').filter(Boolean)
			: []

	const title =
		commits.length === 1
			? commits[0]
			: session.branch.replace(/[-_/]/g, ' ').replace(/^\w+ /, '')
	const body = commits.map(c => `- ${c}`).join('\n')

	const params = new URLSearchParams({ expand: '1', title, body })
	const url = `https://github.com/${ownerRepo}/compare/${baseBranch}...${session.branch}?${params}`

	return { success: true, url }
}

export async function uploadFile(
	sessionId: string,
	file: File,
): Promise<{ path: string } | string> {
	const sessionsState = await loadSessions()
	const session = sessionsState.sessions.find(s => s.id === sessionId)
	if (!session) return `Session not found: ${sessionId}`

	const homeDir = process.env.HOME || '~'
	const imagesDir = `${homeDir}/.config/grove/images`
	await Bun.$`mkdir -p ${imagesDir}`.quiet()

	let fileName = file.name
	const ext = fileName.includes('.') ? '.' + fileName.split('.').pop() : ''
	const base = ext ? fileName.slice(0, -ext.length) : fileName
	let targetPath = `${imagesDir}/${fileName}`
	let counter = 1
	const fs = await import('fs')
	while (fs.existsSync(targetPath)) {
		fileName = `${base}-${counter}${ext}`
		targetPath = `${imagesDir}/${fileName}`
		counter++
	}

	await Bun.write(targetPath, file)
	return { path: targetPath }
}
