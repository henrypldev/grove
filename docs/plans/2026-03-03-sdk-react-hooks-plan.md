# SDK React Hooks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add fully-typed React hooks (`useQuery`, `useMutation`, `useQuerySubscription`) to `@usegrove/sdk/react` for REST and WebSocket integration with TanStack Query.

**Architecture:** A `/react` entrypoint in the existing SDK package. `GroveProvider` holds the client + base URL. Three generic hooks use TypeScript mapped types to provide full autocomplete and type safety from path string literals. WebSocket subscriptions auto-invalidate TanStack Query caches.

**Tech Stack:** React 18+, TanStack Query v5, TypeScript

---

### Task 1: Build configuration and package setup

**Files:**
- Modify: `packages/sdk/package.json`
- Modify: `packages/sdk/tsup.config.ts`
- Modify: `packages/sdk/tsconfig.json`

**Step 1: Add peer dependencies and `/react` export to package.json**

In `packages/sdk/package.json`, add:

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./react": {
      "types": "./dist/react.d.ts",
      "import": "./dist/react.js",
      "require": "./dist/react.cjs"
    }
  },
  "peerDependencies": {
    "react": ">=18",
    "@tanstack/react-query": ">=5"
  },
  "peerDependenciesMeta": {
    "react": { "optional": true },
    "@tanstack/react-query": { "optional": true }
  },
  "devDependencies": {
    "react": "^19.0.0",
    "@tanstack/react-query": "^5.0.0",
    "@types/react": "^19.0.0",
    "tsup": "^8.4.0",
    "typescript": "^5.8.3"
  }
}
```

Peer deps are optional so the base SDK works without React.

**Step 2: Add react entry to tsup config**

In `packages/sdk/tsup.config.ts`, add `'src/react/index.ts'` to the entry array:

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/react/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  external: ['react', '@tanstack/react-query'],
})
```

The `external` array ensures React and TanStack Query are not bundled.

**Step 3: Add JSX support to tsconfig.json**

Check `packages/sdk/tsconfig.json` — ensure it has `"jsx": "react-jsx"` in compilerOptions. If not, add it.

**Step 4: Install dev dependencies**

Run: `cd packages/sdk && bun add -d react @types/react @tanstack/react-query`

**Step 5: Verify build**

Create a minimal `packages/sdk/src/react/index.ts` with just `export {}` so the build doesn't fail.

Run: `cd packages/sdk && bun run build`
Expected: Build succeeds, `dist/react.js`, `dist/react.cjs`, `dist/react.d.ts` are generated.

**Step 6: Commit**

```bash
git add packages/sdk/
git commit -m "feat(sdk): add react entrypoint build config and peer deps"
```

---

### Task 2: Route type map (RouteMap)

**Files:**
- Create: `packages/sdk/src/react/types.ts`

**Step 1: Create the RouteMap interface**

This maps every GET endpoint path to its `params`, `query`, and `response` types. Reference the shared types from `@usegrove/shared`.

Create `packages/sdk/src/react/types.ts`:

```ts
import type {
  Agent,
  AgentTask,
  DashboardResult,
  Repo,
  Script,
  SetupStep,
  Team,
  TeamActivity,
  TeamDetail,
  TeamLog,
  UsageResult,
} from '@usegrove/shared'
import type { SetupLogEntry } from '../types'

/** Maps GET endpoint paths to their param/query/response types */
export interface RouteMap {
  '/v2/version': {
    response: { version: string }
  }
  '/v2/config/settings': {
    response: Record<string, string>
  }
  '/v2/config/clone-directory': {
    response: { cloneDirectory: string }
  }
  '/v2/config/list-directories': {
    query: { path?: string }
    response: { directories: string[] }
  }
  '/v2/github/repos': {
    response: { repos: Array<{ full_name: string; name: string; private: boolean }> }
  }
  '/v2/github/repos/orgs': {
    response: { orgs: Array<{ login: string }> }
  }
  '/v2/github/repos/orgs/:org': {
    params: { org: string }
    response: { repos: Array<{ full_name: string; name: string; private: boolean }> }
  }
  '/v2/repos': {
    response: Repo[]
  }
  '/v2/repos/:id': {
    params: { id: string }
    response: Repo
  }
  '/v2/repos/:id/teams': {
    params: { id: string }
    response: Team[]
  }
  '/v2/repos/:id/setup': {
    params: { id: string }
    response: SetupStep[]
  }
  '/v2/repos/:id/scripts': {
    params: { id: string }
    response: Script[]
  }
  '/v2/teams': {
    response: Team[]
  }
  '/v2/teams/:id': {
    params: { id: string }
    response: TeamDetail
  }
  '/v2/teams/:id/agents': {
    params: { id: string }
    response: Agent[]
  }
  '/v2/teams/:id/activity': {
    params: { id: string }
    query: { since?: number }
    response: TeamActivity[]
  }
  '/v2/teams/:id/logs': {
    params: { id: string }
    query: { since?: number }
    response: TeamLog[]
  }
  '/v2/teams/:id/prd': {
    params: { id: string }
    response: { content: string }
  }
  '/v2/teams/:id/design-doc': {
    params: { id: string }
    response: { content: string }
  }
  '/v2/teams/:id/tasks': {
    params: { id: string }
    response: AgentTask[]
  }
  '/v2/teams/:id/notes': {
    params: { id: string }
    response: { content: string }
  }
  '/v2/teams/:id/setup/logs': {
    params: { id: string }
    response: SetupLogEntry[]
  }
  '/v2/teams/:id/build/logs': {
    params: { id: string }
    response: { status: string; output: string }
  }
  '/v2/teams/:id/dev-server/logs': {
    params: { id: string }
    response: { status: string; output: string }
  }
  '/v2/dashboard': {
    response: DashboardResult
  }
  '/v2/conflicts': {
    response: Record<string, Record<string, string[]>>
  }
  '/v2/usage': {
    query: { period?: string; teamId?: string; repoId?: string }
    response: UsageResult
  }
}

/** Maps "METHOD path" to body/params/response for mutations */
export interface MutationMap {
  'POST /v2/repos': {
    body: { path: string }
    response: Repo
  }
  'POST /v2/repos/clone': {
    body: { fullName: string }
    response: Repo
  }
  'DELETE /v2/repos/:id': {
    params: { id: string }
    response: { success: true }
  }
  'POST /v2/repos/:id/setup': {
    params: { id: string }
    body: { name: string; run: string; background?: boolean }
    response: SetupStep[]
  }
  'PUT /v2/repos/:id/setup': {
    params: { id: string }
    body: { index: number; name: string; run: string; background?: boolean }
    response: SetupStep[]
  }
  'DELETE /v2/repos/:id/setup': {
    params: { id: string }
    body: { index: number }
    response: SetupStep[]
  }
  'PATCH /v2/repos/:id/setup/reorder': {
    params: { id: string }
    body: { order: number[] }
    response: SetupStep[]
  }
  'POST /v2/repos/:id/detect': {
    params: { id: string }
    response: { detecting: true }
  }
  'POST /v2/repos/:id/scripts': {
    params: { id: string }
    body: { name: string; run: string; background?: boolean }
    response: Script
  }
  'PUT /v2/scripts/:id': {
    params: { id: string }
    body: { name: string; run: string; background?: boolean }
    response: Script
  }
  'DELETE /v2/scripts/:id': {
    params: { id: string }
    response: { success: true }
  }
  'PATCH /v2/config/settings': {
    body: Record<string, string>
    response: Record<string, string>
  }
  'PUT /v2/config/clone-directory': {
    body: { cloneDirectory: string }
    response: { cloneDirectory: string }
  }
  'POST /v2/teams': {
    body: { repoId: string; task: string; files?: File[] }
    response: Team | { teams: Team[] }
  }
  'DELETE /v2/teams/:id': {
    params: { id: string }
    response: { success: true }
  }
  'POST /v2/teams/:id/close': {
    params: { id: string }
    response: { success: true }
  }
  'POST /v2/teams/:id/messages': {
    params: { id: string }
    body: { text?: string; files?: File[]; answers?: Record<string, string> }
    response: TeamActivity
  }
  'POST /v2/teams/:id/agents': {
    params: { id: string }
    body: { role: 'team-lead' | 'dev' | 'qa' | 'reviewer' }
    response: Agent
  }
  'POST /v2/teams/:teamId/agents/:agentId/respawn': {
    params: { teamId: string; agentId: string }
    body: { prompt?: string }
    response: { success: boolean }
  }
  'POST /v2/teams/:id/setup/retry': {
    params: { id: string }
    response: { success: true }
  }
  'POST /v2/teams/:id/setup/cancel': {
    params: { id: string }
    response: { success: true }
  }
  'POST /v2/teams/:id/setup/start': {
    params: { id: string }
    body: { step: number }
    response: { success: true }
  }
  'POST /v2/teams/:id/setup/stop': {
    params: { id: string }
    body: { step: number }
    response: { success: true }
  }
  'POST /v2/teams/:id/build': {
    params: { id: string }
    response: { success: true }
  }
  'POST /v2/teams/:id/build/stop': {
    params: { id: string }
    response: { success: true }
  }
  'POST /v2/teams/:teamId/scripts/:scriptId/run': {
    params: { teamId: string; scriptId: string }
    response: { success: true }
  }
  'POST /v2/teams/:id/scripts/stop': {
    params: { id: string }
    response: { success: true }
  }
  'POST /v2/teams/:id/dev-server': {
    params: { id: string }
    response: { success: true; port: number }
  }
  'POST /v2/teams/:id/dev-server/stop': {
    params: { id: string }
    response: { success: true }
  }
  'POST /v2/teams/:id/dev-server/stdin': {
    params: { id: string }
    body: { input: string }
    response: { success: true }
  }
  'POST /v2/activity': {
    body: { teamId: string; agentId: string; type: string; payload: Record<string, unknown> }
    response: TeamActivity
  }
  'POST /v2/update': {
    response: void
  }
}

/** Maps WS event names to their payload types */
export interface SubscriptionMap {
  activity: { data: TeamActivity; channel: string }
  log: { data: TeamLog; channel: string }
  'team:update': { data: Partial<Team> & { id: string }; channel: string }
  'agent:update': { data: Partial<Agent> & { id: string; teamId: string }; channel: string }
  'replay:batch': { data: TeamActivity[]; channel: string }
}

/** Utility: extract params type from RouteMap entry, defaulting to {} */
export type RouteParams<P extends keyof RouteMap> =
  'params' extends keyof RouteMap[P] ? RouteMap[P]['params'] : undefined

/** Utility: extract query type from RouteMap entry */
export type RouteQuery<P extends keyof RouteMap> =
  'query' extends keyof RouteMap[P] ? RouteMap[P]['query'] : undefined

/** Utility: extract response type */
export type RouteResponse<P extends keyof RouteMap> = RouteMap[P]['response']

/** Extract method + path key from MutationMap */
export type MutationKey = keyof MutationMap

/** Utility: extract parts from a MutationMap entry */
export type MutationParams<K extends MutationKey> =
  'params' extends keyof MutationMap[K] ? MutationMap[K]['params'] : undefined

export type MutationBody<K extends MutationKey> =
  'body' extends keyof MutationMap[K] ? MutationMap[K]['body'] : undefined

export type MutationResponse<K extends MutationKey> = MutationMap[K]['response']

/** Subscription event names */
export type SubscriptionEvent = keyof SubscriptionMap
```

**Step 2: Commit**

```bash
git add packages/sdk/src/react/types.ts
git commit -m "feat(sdk): add RouteMap, MutationMap, SubscriptionMap types"
```

---

### Task 3: GroveProvider and useGrove

**Files:**
- Create: `packages/sdk/src/react/provider.tsx`
- Modify: `packages/sdk/src/react/index.ts`

**Step 1: Create the provider**

Create `packages/sdk/src/react/provider.tsx`:

```tsx
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { GroveClient } from '../client'
import type { ConnectionStatus } from '../types'

interface GroveContextValue {
  client: GroveClient
  baseUrl: string
  status: ConnectionStatus
}

const GroveContext = createContext<GroveContextValue | null>(null)

export interface GroveProviderProps {
  url: string
  children: React.ReactNode
  /** Set to false to disable automatic WebSocket connection. Default: true */
  autoConnect?: boolean
  deviceType?: 'mac' | 'mobile'
}

export function GroveProvider({ url, children, autoConnect = true, deviceType }: GroveProviderProps) {
  // Derive WS URL from HTTP URL
  const wsUrl = useMemo(() => {
    const u = url.replace('https://', 'wss://').replace('http://', 'ws://')
    return u.endsWith('/ws') ? u : `${u}/ws`
  }, [url])

  // Derive REST base URL
  const baseUrl = useMemo(() => {
    return url.replace(/\/ws\/?$/, '')
  }, [url])

  const clientRef = useRef<GroveClient | null>(null)
  if (!clientRef.current || clientRef.current.status === 'disconnected') {
    clientRef.current = new GroveClient({ url: wsUrl, deviceType })
  }
  const client = clientRef.current

  const [status, setStatus] = useState<ConnectionStatus>(client.status)

  useEffect(() => {
    const onConnected = () => setStatus('connected')
    const onDisconnected = () => setStatus('disconnected')
    const onReconnecting = () => setStatus('connecting')

    client.on('connected', onConnected)
    client.on('disconnected', onDisconnected)
    client.on('reconnecting', onReconnecting)

    if (autoConnect) {
      client.connect().catch(() => {})
    }

    return () => {
      client.off('connected', onConnected)
      client.off('disconnected', onDisconnected)
      client.off('reconnecting', onReconnecting)
      client.disconnect()
    }
  }, [client, autoConnect])

  const value = useMemo(() => ({ client, baseUrl, status }), [client, baseUrl, status])

  return <GroveContext.Provider value={value}>{children}</GroveContext.Provider>
}

export function useGrove(): GroveContextValue {
  const ctx = useContext(GroveContext)
  if (!ctx) throw new Error('useGrove must be used within a <GroveProvider>')
  return ctx
}
```

Note: The `GroveClient` currently extends `TypedEmitter` which has `on`/`off` methods. Check `packages/sdk/src/events.ts` to confirm it has an `off` method. If not, use `removeListener` or add `off`.

**Step 2: Update react/index.ts exports**

```ts
export { GroveProvider, useGrove } from './provider'
export type { GroveProviderProps } from './provider'
export type { RouteMap, MutationMap, SubscriptionMap } from './types'
```

**Step 3: Build and verify**

Run: `cd packages/sdk && bun run build`
Expected: Builds without errors.

**Step 4: Commit**

```bash
git add packages/sdk/src/react/
git commit -m "feat(sdk): add GroveProvider and useGrove hook"
```

---

### Task 4: useQuery hook

**Files:**
- Create: `packages/sdk/src/react/useQuery.ts`
- Modify: `packages/sdk/src/react/index.ts`

**Step 1: Create the useQuery hook**

Create `packages/sdk/src/react/useQuery.ts`:

```ts
import {
  useQuery as useTanstackQuery,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useGrove } from './provider'
import type { RouteMap, RouteParams, RouteQuery, RouteResponse } from './types'

/** Build the actual URL from a path template and params */
function buildUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string>,
  query?: Record<string, unknown>,
): string {
  let url = `${baseUrl}${path}`
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url = url.replace(`:${key}`, encodeURIComponent(value))
    }
  }
  if (query) {
    const searchParams = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        searchParams.set(key, String(value))
      }
    }
    const qs = searchParams.toString()
    if (qs) url += `?${qs}`
  }
  return url
}

/** Options for useQuery — conditionally requires params/query based on route */
type UseGroveQueryOptions<P extends keyof RouteMap> = {
  /** TanStack Query options pass-through */
  enabled?: boolean
  refetchInterval?: number
  staleTime?: number
  gcTime?: number
} & (RouteParams<P> extends undefined ? {} : { params: RouteParams<P> }) &
  (RouteQuery<P> extends undefined ? { query?: never } : { query?: RouteQuery<P> })

export function useQuery<P extends keyof RouteMap>(
  path: P,
  options?: UseGroveQueryOptions<P>,
): UseQueryResult<RouteResponse<P>> {
  const { baseUrl } = useGrove()
  const params = (options as any)?.params
  const query = (options as any)?.query

  return useTanstackQuery({
    queryKey: [path, params, query].filter(Boolean),
    queryFn: async () => {
      const url = buildUrl(baseUrl, path, params, query)
      const res = await fetch(url)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      return res.json()
    },
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}
```

**Step 2: Export from react/index.ts**

Add: `export { useQuery } from './useQuery'`

**Step 3: Build and verify**

Run: `cd packages/sdk && bun run build`
Expected: Builds without errors.

**Step 4: Commit**

```bash
git add packages/sdk/src/react/
git commit -m "feat(sdk): add typed useQuery hook for REST endpoints"
```

---

### Task 5: useMutation hook

**Files:**
- Create: `packages/sdk/src/react/useMutation.ts`
- Modify: `packages/sdk/src/react/index.ts`

**Step 1: Create the useMutation hook**

Create `packages/sdk/src/react/useMutation.ts`:

```ts
import {
  useMutation as useTanstackMutation,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query'
import { useGrove } from './provider'
import type { MutationBody, MutationKey, MutationParams, MutationResponse } from './types'

type HttpMethod = 'POST' | 'PUT' | 'DELETE' | 'PATCH'

/** Parse "METHOD /path" into { method, path } */
function parseMutationKey(key: string): { method: HttpMethod; path: string } {
  const spaceIdx = key.indexOf(' ')
  return {
    method: key.slice(0, spaceIdx) as HttpMethod,
    path: key.slice(spaceIdx + 1),
  }
}

/** Build URL from path template and params */
function buildUrl(baseUrl: string, path: string, params?: Record<string, string>): string {
  let url = `${baseUrl}${path}`
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url = url.replace(`:${key}`, encodeURIComponent(value))
    }
  }
  return url
}

/** Variables passed to mutate() — conditional params and body */
type MutationVariables<K extends MutationKey> =
  (MutationParams<K> extends undefined ? {} : { params: MutationParams<K> }) &
  (MutationBody<K> extends undefined ? {} : { body: MutationBody<K> })

/** Options for useMutation */
type UseGroveMutationOptions<K extends MutationKey> = {
  onSuccess?: (data: MutationResponse<K>) => void
  onError?: (error: Error) => void
}

/** Check if body contains File objects (needs FormData) */
function hasFiles(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  return Object.values(body as Record<string, unknown>).some(
    (v) => v instanceof File || (Array.isArray(v) && v.some((item) => item instanceof File))
  )
}

/** Build FormData from a body object */
function toFormData(body: Record<string, unknown>): FormData {
  const fd = new FormData()
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const item of value) {
        fd.append(key, item instanceof File ? item : String(item))
      }
    } else if (value instanceof File) {
      fd.append(key, value)
    } else if (typeof value === 'object') {
      fd.append(key, JSON.stringify(value))
    } else {
      fd.append(key, String(value))
    }
  }
  return fd
}

export function useMutation<K extends MutationKey>(
  key: K,
  options?: UseGroveMutationOptions<K>,
): UseMutationResult<MutationResponse<K>, Error, MutationVariables<K>> {
  const { baseUrl } = useGrove()
  const { method, path } = parseMutationKey(key)

  return useTanstackMutation({
    mutationFn: async (variables: MutationVariables<K>) => {
      const params = (variables as any)?.params
      const body = (variables as any)?.body
      const url = buildUrl(baseUrl, path, params)

      const init: RequestInit = { method }

      if (body !== undefined) {
        if (hasFiles(body)) {
          init.body = toFormData(body as Record<string, unknown>)
        } else {
          init.headers = { 'Content-Type': 'application/json' }
          init.body = JSON.stringify(body)
        }
      }

      const res = await fetch(url, init)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as any).error ?? `HTTP ${res.status}`)
      }
      // Some DELETE endpoints return 204 with no body
      const text = await res.text()
      return text ? JSON.parse(text) : undefined
    },
    onSuccess: options?.onSuccess as any,
    onError: options?.onError,
  })
}
```

**Step 2: Export from react/index.ts**

Add: `export { useMutation } from './useMutation'`

**Step 3: Build and verify**

Run: `cd packages/sdk && bun run build`
Expected: Builds without errors.

**Step 4: Commit**

```bash
git add packages/sdk/src/react/
git commit -m "feat(sdk): add typed useMutation hook for REST mutations"
```

---

### Task 6: useQuerySubscription hook

**Files:**
- Create: `packages/sdk/src/react/useQuerySubscription.ts`
- Modify: `packages/sdk/src/react/index.ts`

**Step 1: Create the subscription hook**

Create `packages/sdk/src/react/useQuerySubscription.ts`:

```ts
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useGrove } from './provider'
import type { SubscriptionEvent, SubscriptionMap } from './types'

/** Cache invalidation mapping: WS event → query paths to invalidate */
const INVALIDATION_MAP: Record<SubscriptionEvent, string[]> = {
  'team:update': ['/v2/teams', '/v2/dashboard'],
  'agent:update': ['/v2/teams'],
  activity: ['/v2/teams'],
  log: ['/v2/teams'],
  'replay:batch': ['/v2/teams'],
}

type SubscriptionData<E extends SubscriptionEvent> = SubscriptionMap[E]['data']

interface UseQuerySubscriptionOptions {
  channel: string
  enabled?: boolean
}

interface UseQuerySubscriptionResult<E extends SubscriptionEvent> {
  data: SubscriptionData<E> | null
  history: SubscriptionData<E>[]
}

export function useQuerySubscription<E extends SubscriptionEvent>(
  event: E,
  options: UseQuerySubscriptionOptions,
): UseQuerySubscriptionResult<E> {
  const { client } = useGrove()
  const queryClient = useQueryClient()
  const { channel, enabled = true } = options

  const [data, setData] = useState<SubscriptionData<E> | null>(null)
  const historyRef = useRef<SubscriptionData<E>[]>([])
  const [history, setHistory] = useState<SubscriptionData<E>[]>([])

  const handler = useCallback(
    (eventData: any, eventChannel: string) => {
      if (eventChannel !== channel && event !== 'team:update') return

      setData(eventData)
      historyRef.current = [...historyRef.current, eventData]
      setHistory(historyRef.current)

      // Invalidate relevant queries
      const paths = INVALIDATION_MAP[event]
      if (paths) {
        for (const path of paths) {
          queryClient.invalidateQueries({ queryKey: [path] })
        }
      }
    },
    [channel, event, queryClient],
  )

  useEffect(() => {
    if (!enabled) return

    // Subscribe to channel
    client.subscribe([channel])

    // Listen for events
    // The GroveClient emits events with signature: (data, channel)
    client.on(event as any, handler)

    return () => {
      client.off(event as any, handler)
      client.unsubscribe([channel])
    }
  }, [client, channel, event, enabled, handler])

  return { data, history }
}
```

Note: Check `packages/sdk/src/events.ts` to confirm `off` method exists. If only `removeListener` exists, use that instead.

**Step 2: Export from react/index.ts**

Add: `export { useQuerySubscription } from './useQuerySubscription'`

**Step 3: Build and verify**

Run: `cd packages/sdk && bun run build`
Expected: Builds without errors.

**Step 4: Commit**

```bash
git add packages/sdk/src/react/
git commit -m "feat(sdk): add useQuerySubscription hook with cache invalidation"
```

---

### Task 7: Final exports and build verification

**Files:**
- Modify: `packages/sdk/src/react/index.ts`

**Step 1: Verify final react/index.ts has all exports**

```ts
export { GroveProvider, useGrove } from './provider'
export type { GroveProviderProps } from './provider'
export { useQuery } from './useQuery'
export { useMutation } from './useMutation'
export { useQuerySubscription } from './useQuerySubscription'
export type {
  RouteMap,
  MutationMap,
  MutationKey,
  SubscriptionMap,
  SubscriptionEvent,
} from './types'
```

**Step 2: Full build**

Run: `cd packages/sdk && bun run build`
Expected: All outputs generated:
- `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts`
- `dist/react.js`, `dist/react.cjs`, `dist/react.d.ts`

**Step 3: Verify the base SDK is unchanged**

Run: `cd packages/sdk && bun run test`
Expected: All existing tests pass.

**Step 4: Commit**

```bash
git add packages/sdk/
git commit -m "feat(sdk): finalize react hooks exports and verify build"
```

---

### Task 8: Check events.ts for off() method

**Files:**
- Possibly modify: `packages/sdk/src/events.ts`

**Step 1: Read events.ts**

Read `packages/sdk/src/events.ts` and check if it has an `off()` method.

**Step 2: Add off() if missing**

If only `removeListener` exists, add an `off` alias:

```ts
off<E extends keyof T>(event: E, fn: T[E]): void {
  this.removeListener(event, fn)
}
```

**Step 3: Build and verify**

Run: `cd packages/sdk && bun run build && bun run test`

**Step 4: Commit if changed**

```bash
git add packages/sdk/src/events.ts
git commit -m "feat(sdk): add off() method to TypedEmitter"
```
