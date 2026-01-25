import AsyncStorage from '@react-native-async-storage/async-storage'

const SERVER_URL_KEY = 'klaude_server_url'
const TERMINAL_HOST_KEY = 'klaude_terminal_host'

let serverUrl: string | null = null
let terminalHost: string | null = null

export async function getServerUrl(): Promise<string | null> {
  if (serverUrl) return serverUrl
  serverUrl = await AsyncStorage.getItem(SERVER_URL_KEY)
  return serverUrl
}

export async function setServerUrl(url: string): Promise<void> {
  serverUrl = url
  await AsyncStorage.setItem(SERVER_URL_KEY, url)
}

export async function getTerminalHost(): Promise<string | null> {
  if (terminalHost) return terminalHost
  terminalHost = await AsyncStorage.getItem(TERMINAL_HOST_KEY)
  return terminalHost
}

export async function setTerminalHost(host: string): Promise<void> {
  terminalHost = host
  await AsyncStorage.setItem(TERMINAL_HOST_KEY, host)
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const baseUrl = await getServerUrl()
  if (!baseUrl) {
    throw new Error('Server URL not configured')
  }
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`)
  }
  return res.json()
}

export interface Session {
  id: string
  repoId: string
  repoName: string
  worktree: string
  branch: string
  port: number
  createdAt: string
}

export interface Repo {
  id: string
  path: string
  name: string
}

export interface Worktree {
  path: string
  branch: string
  isMain: boolean
}

export const api = {
  getSessions: () => fetchApi<Session[]>('/sessions'),

  createSession: (data: { repoId: string; worktree: string }) =>
    fetchApi<Session>('/sessions', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteSession: (id: string) =>
    fetchApi<void>(`/sessions/${id}`, { method: 'DELETE' }),

  getRepos: () => fetchApi<Repo[]>('/repos'),

  addRepo: (path: string) =>
    fetchApi<Repo>('/repos', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  deleteRepo: (id: string) =>
    fetchApi<void>(`/repos/${id}`, { method: 'DELETE' }),

  getWorktrees: (repoId: string) =>
    fetchApi<Worktree[]>(`/worktrees/${repoId}`),

  createWorktree: (data: { repoId: string; branch: string; baseBranch: string }) =>
    fetchApi<Worktree>('/worktrees', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}
