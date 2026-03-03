# SDK React Hooks Design

## Overview

Add React hooks to `@usegrove/sdk` via a `/react` entrypoint. Two typed generic hooks (`useQuery`, `useMutation`) for REST endpoints, one typed subscription hook (`useQuerySubscription`) for WebSocket events, plus a `GroveProvider` and `useGrove` for context.

## Exports

```
@usegrove/sdk/react
├── GroveProvider        — context provider (holds REST base URL, GroveClient, QueryClient)
├── useGrove             — access client + connection status
├── useQuery             — typed GET requests via TanStack Query
├── useMutation          — typed POST/PUT/DELETE via TanStack useMutation
└── useQuerySubscription — typed WS event subscriptions with cache invalidation
```

## API

### GroveProvider

```tsx
<QueryClientProvider client={queryClient}>
  <GroveProvider url="https://grove.example.com">
    <App />
  </GroveProvider>
</QueryClientProvider>
```

Props:
- `url` — Grove server URL (used for both REST base URL and WebSocket connection)
- `children` — React children

The provider creates and manages a `GroveClient` internally, deriving the WS URL from the provided HTTP URL.

### useGrove()

```tsx
const { client, status } = useGrove()
// client: GroveClient instance
// status: 'disconnected' | 'connecting' | 'connected'
```

### useQuery(path, options?)

Typed GET requests. Path literal determines response type and required params.

```tsx
const { data, isLoading, error } = useQuery('/v2/teams')
const { data } = useQuery('/v2/teams/:id', { params: { id: '123' } })
const { data } = useQuery('/v2/usage', { query: { period: '7d' } })
```

Options:
- `params` — path parameters (required when path contains `:param`)
- `query` — query string parameters
- `enabled` — TanStack Query enabled flag
- All other TanStack `useQuery` options are passed through

### useMutation(path, options?)

Typed mutations. Method defaults to POST.

```tsx
const createTeam = useMutation('/v2/teams')
const deleteTeam = useMutation('/v2/teams/:id', { method: 'DELETE' })
const updateScript = useMutation('/v2/scripts/:id', { method: 'PUT' })

// Usage
createTeam.mutate({ body: { repoId: '...', task: '...' } })
deleteTeam.mutate({ params: { id: '123' } })
```

Options:
- `method` — 'POST' (default) | 'PUT' | 'DELETE' | 'PATCH'
- `params` — static path parameters (can also be passed per-call via mutate)
- All other TanStack `useMutation` options are passed through

### useQuerySubscription(event, options)

Subscribe to WebSocket events. Auto-invalidates relevant TanStack Query caches.

```tsx
const { data, history } = useQuerySubscription('activity', { channel: teamId })
const { data } = useQuerySubscription('team:update', { channel: teamId })
const { data } = useQuerySubscription('agent:update', { channel: teamId })
const { data } = useQuerySubscription('log', { channel: teamId })
```

Options:
- `channel` — channel ID to subscribe to (typically teamId)
- `enabled` — enable/disable subscription

Returns:
- `data` — latest event payload (typed per event name)
- `history` — array of recent events

Cache invalidation mapping:
- `team:update` → `/v2/teams`, `/v2/teams/:id`, `/v2/dashboard`
- `agent:update` → `/v2/teams/:id/agents`
- `activity` → `/v2/teams/:id/activity`
- `log` → `/v2/teams/:id/logs`

## Type System

A `RouteMap` interface maps each path string to its types:

```ts
interface RouteMap {
  '/v2/teams': {
    response: Team[]
  }
  '/v2/teams/:id': {
    params: { id: string }
    response: TeamDetail
  }
  '/v2/teams/:id/activity': {
    params: { id: string }
    query: { since?: string }
    response: TeamActivity[]
  }
  // ... all v2 endpoints
}
```

A `MutationMap` maps path + method to body/response types:

```ts
interface MutationMap {
  'POST /v2/teams': {
    body: { repoId: string; task: string; files?: File[] }
    response: Team
  }
  'DELETE /v2/teams/:id': {
    params: { id: string }
    response: void
  }
  // ... all write endpoints
}
```

A `SubscriptionMap` maps event names to payload types:

```ts
interface SubscriptionMap {
  'activity': { data: TeamActivity; channel: string }
  'log': { data: TeamLog; channel: string }
  'team:update': { data: Team; channel: string }
  'agent:update': { data: Agent; channel: string }
}
```

## Dependencies

- `react` >= 18 (peer)
- `@tanstack/react-query` >= 5 (peer)

## Build

Add a `/react` export to `package.json`:

```json
{
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs" },
    "./react": { "types": "./dist/react.d.ts", "import": "./dist/react.js", "require": "./dist/react.cjs" }
  }
}
```

Separate tsup entry point so the React code is tree-shakeable and doesn't pollute the base SDK.

## File Structure

```
packages/sdk/src/
├── index.ts          (existing — no changes)
├── client.ts         (existing — no changes)
├── rest.ts           (existing — no changes)
├── react/
│   ├── index.ts      (exports all hooks + provider)
│   ├── provider.tsx  (GroveProvider + useGrove)
│   ├── useQuery.ts   (typed REST query hook)
│   ├── useMutation.ts(typed REST mutation hook)
│   ├── useQuerySubscription.ts (typed WS subscription hook)
│   └── types.ts      (RouteMap, MutationMap, SubscriptionMap)
```
