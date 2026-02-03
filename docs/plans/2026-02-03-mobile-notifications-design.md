# Mobile Notifications Design

## Overview

Add notification functionality to the Grove mobile app with two channels:
- **In-app toasts** - Immediate minimal banner when session transitions busy → waiting
- **Push notifications** - Server-managed, 15s delay, delivered via Expo Push Service

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      GROVE SERVER                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Session State Monitor (existing)                    │   │
│  │  - Polls tmux every 500ms-2s                        │   │
│  │  - Detects busy → waiting transitions               │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                   │
│                         ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Push Notification Manager (NEW)                     │   │
│  │  - Stores device push tokens                        │   │
│  │  - Tracks 15s delay per session                     │   │
│  │  - Sends to Expo Push Service                       │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    MOBILE APP                               │
│  ┌─────────────────────┐  ┌─────────────────────────────┐  │
│  │  SSE Listener       │  │  Push Token Registration    │  │
│  │  (existing)         │  │  (NEW)                      │  │
│  │  - state_change →   │  │  - expo-notifications       │  │
│  │    show toast       │  │  - Register token w/ server │  │
│  └─────────────────────┘  └─────────────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Notification Settings (NEW)                         │   │
│  │  - Push notifications toggle                        │   │
│  │  - In-app toasts toggle                             │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Server Changes

### New API Endpoints

```
POST /push-tokens
  Body: { token: string, platform: "ios" | "android" }
  - Registers device push token
  - Stores in config alongside existing data

DELETE /push-tokens
  Body: { token: string }
  - Removes a push token (for logout/uninstall)
```

### Config Storage

Added to `~/.config/grove/config.json`:

```typescript
interface PushToken {
  token: string
  platform: "ios" | "android"
  registeredAt: string
}

interface Config {
  repos: Repo[]
  webhookUrl?: string
  cloneDirectory?: string
  pushTokens?: PushToken[]  // NEW
}
```

### Push Notification Logic

In `sessions.ts`:

```typescript
const waitingSince: Map<string, number> = new Map()

// On state change detection:
if (previousState === "busy" && newState === "waiting") {
  waitingSince.set(sessionId, Date.now())
}

// Timer checks every 5 seconds:
for (const [sessionId, startTime] of waitingSince) {
  if (Date.now() - startTime >= 15000) {
    sendPushNotification(session)
    waitingSince.delete(sessionId)
  }
}

// When session leaves "waiting":
if (newState !== "waiting") {
  waitingSince.delete(sessionId)
}
```

### Expo Push Integration

```typescript
async function sendPushNotification(session: Session) {
  const tokens = config.pushTokens ?? []
  if (tokens.length === 0) return

  await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tokens.map(t => ({
      to: t.token,
      title: "Session ready",
      body: `${session.repoName} (${session.branch}) is waiting for input`,
      data: { sessionId: session.id }
    })))
  })
}
```

## Mobile App Changes

### Dependencies

```bash
npx expo install expo-notifications
```

### Push Token Registration

New file `src/services/notifications.ts`:

```typescript
import * as Notifications from "expo-notifications"
import { getServerUrl } from "./api"

export async function registerForPushNotifications() {
  const { status } = await Notifications.requestPermissionsAsync()
  if (status !== "granted") return null

  const token = (await Notifications.getExpoPushTokenAsync()).data

  await fetch(`${getServerUrl()}/push-tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token,
      platform: Platform.OS
    })
  })

  return token
}

export async function unregisterPushToken(token: string) {
  await fetch(`${getServerUrl()}/push-tokens`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token })
  })
}
```

### Deep Link Handling

In `_layout.tsx`:

```typescript
Notifications.addNotificationResponseReceivedListener((response) => {
  const sessionId = response.notification.request.content.data?.sessionId
  if (sessionId) {
    router.push(`/sessions/${sessionId}`)
  }
})
```

### In-App Toast

New component `src/components/SessionToast.tsx`:
- Minimal banner at top of screen
- Shows session name + "ready for input"
- Auto-dismisses after 3 seconds
- Tap navigates to `/sessions/[id]`

### Toast Trigger

In SSE listener (`src/services/api.ts`):

```typescript
const previousStates = new Map<string, SessionState>()

// On SSE "sessions" message:
for (const session of sessions) {
  const prev = previousStates.get(session.id)
  if (prev === "busy" && session.state === "waiting") {
    showSessionToast(session)
  }
  previousStates.set(session.id, session.state)
}
```

### Settings Storage

AsyncStorage keys:
- `grove_push_notifications_enabled` - boolean, default true
- `grove_in_app_toasts_enabled` - boolean, default true

### Settings UI

New section in Settings screen:

```
┌─────────────────────────────────────────┐
│  Notifications                          │
├─────────────────────────────────────────┤
│  Push Notifications              [ON]   │
│  Notify when a session is ready         │
│                                         │
│  In-App Toasts                   [ON]   │
│  Show banner when session becomes ready │
└─────────────────────────────────────────┘
```

Behavior:
- Push toggle ON → Requests permission if not granted, registers token
- Push toggle OFF → Unregisters token from server
- In-app toast toggle → Local preference only

## Implementation Tasks

### Server (grove)

1. Add `PushToken` type to config types
2. Add `pushTokens` array to config with load/save helpers
3. Create `POST /push-tokens` endpoint
4. Create `DELETE /push-tokens` endpoint
5. Add `waitingSince` Map to track session waiting times
6. Add 5-second timer to check for 15s threshold
7. Implement `sendPushNotification()` with Expo Push API
8. Clean up `waitingSince` when sessions leave waiting state

### Mobile App (grove-app)

1. Install `expo-notifications`
2. Create `src/services/notifications.ts` with register/unregister functions
3. Create `src/components/SessionToast.tsx` component
4. Add state transition tracking to SSE listener
5. Add toast display logic (respecting settings)
6. Add notification response listener for deep linking in `_layout.tsx`
7. Add notification settings section to SettingsContent
8. Add AsyncStorage keys for notification preferences
9. Wire up settings toggles to register/unregister tokens

## Notification Content

**Push Notification:**
- Title: "Session ready"
- Body: "{repoName} ({branch}) is waiting for input"
- Data: `{ sessionId: string }`

**In-App Toast:**
- Text: "{repoName} ({branch}) ready"
- Auto-dismiss: 3 seconds
- Action: Navigate to session on tap
