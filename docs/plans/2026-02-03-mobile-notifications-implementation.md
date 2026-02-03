# Mobile Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add push notifications and in-app toasts to the Grove mobile app when sessions become ready.

**Architecture:** Server tracks device push tokens and manages 15-second delay before sending push via Expo Push Service. Mobile app shows immediate in-app toasts via SSE state tracking and handles deep linking from notification taps.

**Tech Stack:** Bun server, Expo Push Service, expo-notifications, React Native, AsyncStorage

---

## Task 1: Server - Add PushToken type and config helpers

**Files:**
- Modify: `/Users/henry/.claude-worktrees/grove/feat-mobile-notifications/server/src/config/index.ts`

**Step 1: Add PushToken interface after SessionData interface (around line 56)**

```typescript
export interface PushToken {
	token: string
	platform: 'ios' | 'android'
	registeredAt: string
}
```

**Step 2: Update Config interface to include pushTokens (around line 93)**

```typescript
interface Config {
	repos: Repo[]
	webhookUrl?: string
	cloneDirectory?: string
	pushTokens?: PushToken[]
}
```

**Step 3: Add helper functions for push token management (after saveConfig, around line 127)**

```typescript
export async function getPushTokens(): Promise<PushToken[]> {
	const config = await loadConfig()
	return config.pushTokens ?? []
}

export async function addPushToken(token: string, platform: 'ios' | 'android'): Promise<void> {
	const config = await loadConfig()
	if (!config.pushTokens) config.pushTokens = []
	const existing = config.pushTokens.find(t => t.token === token)
	if (existing) {
		existing.platform = platform
		existing.registeredAt = new Date().toISOString()
	} else {
		config.pushTokens.push({
			token,
			platform,
			registeredAt: new Date().toISOString(),
		})
	}
	await saveConfig(config)
}

export async function removePushToken(token: string): Promise<boolean> {
	const config = await loadConfig()
	if (!config.pushTokens) return false
	const index = config.pushTokens.findIndex(t => t.token === token)
	if (index === -1) return false
	config.pushTokens.splice(index, 1)
	await saveConfig(config)
	return true
}
```

**Step 4: Commit**

```bash
git add server/src/config/index.ts
git commit -m "feat(server): add push token types and config helpers"
```

---

## Task 2: Server - Add push token API endpoints

**Files:**
- Modify: `/Users/henry/.claude-worktrees/grove/feat-mobile-notifications/server/src/index.ts`

**Step 1: Add imports for push token helpers (update import from config around line 29)**

Update the import statement to include the new functions:
```typescript
import {
	getCloneDirectory,
	listDirectories,
	loadConfig,
	log,
	saveConfig,
	setLogsEnabled,
	addPushToken,
	removePushToken,
} from './config'
```

**Step 2: Add POST /push-tokens endpoint (after /webhook DELETE handler, around line 425)**

```typescript
if (path === '/push-tokens' && method === 'POST') {
	const body = await req.json()
	if (!body.token || typeof body.token !== 'string') {
		return Response.json(
			{ error: 'Missing token field' },
			{ status: 400, headers },
		)
	}
	if (body.platform !== 'ios' && body.platform !== 'android') {
		return Response.json(
			{ error: 'Invalid platform, must be ios or android' },
			{ status: 400, headers },
		)
	}
	await addPushToken(body.token, body.platform)
	log('push', 'registered token', { platform: body.platform })
	return Response.json({ success: true }, { headers })
}

if (path === '/push-tokens' && method === 'DELETE') {
	const body = await req.json()
	if (!body.token || typeof body.token !== 'string') {
		return Response.json(
			{ error: 'Missing token field' },
			{ status: 400, headers },
		)
	}
	const removed = await removePushToken(body.token)
	log('push', 'removed token', { removed })
	return Response.json({ success: removed }, { headers })
}
```

**Step 3: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(server): add push token registration endpoints"
```

---

## Task 3: Server - Add push notification logic with 15s delay

**Files:**
- Modify: `/Users/henry/.claude-worktrees/grove/feat-mobile-notifications/server/src/api/sessions.ts`

**Step 1: Add import for getPushTokens (update import around line 1)**

```typescript
import {
	generateId,
	getPushTokens,
	getTerminalHost,
	loadConfig,
	loadSessions,
	log,
	type SessionData,
	saveConfig,
} from '../config'
```

**Step 2: Add waiting state tracking and push notification timer (after currentPollingInterval declaration, around line 29)**

```typescript
const waitingSince = new Map<string, number>()
const notifiedSessions = new Set<string>()
let pushCheckInterval: ReturnType<typeof setInterval> | null = null
const PUSH_DELAY_MS = 15000

function startPushCheckInterval() {
	if (pushCheckInterval) return
	pushCheckInterval = setInterval(checkAndSendPushNotifications, 5000)
}

function stopPushCheckInterval() {
	if (pushCheckInterval) {
		clearInterval(pushCheckInterval)
		pushCheckInterval = null
	}
}

async function checkAndSendPushNotifications() {
	const now = Date.now()
	for (const [sessionId, startTime] of waitingSince) {
		if (now - startTime >= PUSH_DELAY_MS && !notifiedSessions.has(sessionId)) {
			const sessions = await getSessions()
			const session = sessions.find(s => s.id === sessionId)
			if (session && session.state === 'waiting') {
				await sendPushNotification(session)
				notifiedSessions.add(sessionId)
			}
		}
	}
}

async function sendPushNotification(session: SessionWithStatus) {
	const tokens = await getPushTokens()
	if (tokens.length === 0) return

	log('push', 'sending notification', { sessionId: session.id, tokenCount: tokens.length })

	try {
		const response = await fetch('https://exp.host/--/api/v2/push/send', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'application/json',
			},
			body: JSON.stringify(
				tokens.map(t => ({
					to: t.token,
					title: 'Session ready',
					body: `${session.repoName} (${session.branch}) is waiting for input`,
					data: { sessionId: session.id },
					sound: 'default',
				})),
			),
		})
		const result = await response.json()
		log('push', 'notification sent', { result })
	} catch (err) {
		log('push', 'failed to send', { error: String(err) })
	}
}
```

**Step 3: Update broadcastSessions to track waiting state and manage push interval (modify the function around line 100)**

Find the existing `broadcastSessions` function and update it to track waiting states:

```typescript
export async function broadcastSessions() {
	const sessions = await getSessions()

	for (const session of sessions) {
		const prev = previousStates.get(session.id)
		if (prev && prev !== session.state) {
			const payload = {
				type: 'state_change',
				session: {
					id: session.id,
					repoName: session.repoName,
					branch: session.branch,
				},
				from: prev,
				to: session.state,
			}
			broadcastSSE(`data: ${JSON.stringify(payload)}\n\n`)
			if (prev === 'busy' && session.state === 'waiting') {
				fireWebhook(payload)
				waitingSince.set(session.id, Date.now())
				startPushCheckInterval()
			}
		}
		previousStates.set(session.id, session.state)

		if (session.state !== 'waiting') {
			waitingSince.delete(session.id)
			notifiedSessions.delete(session.id)
		}
	}

	const activeWaiting = Array.from(waitingSince.keys()).some(id =>
		sessions.find(s => s.id === id && s.state === 'waiting'),
	)
	if (!activeWaiting) {
		stopPushCheckInterval()
	}

	broadcastSSE(`data: ${JSON.stringify({ type: 'sessions', sessions })}\n\n`)
}
```

**Step 4: Commit**

```bash
git add server/src/api/sessions.ts
git commit -m "feat(server): add push notifications with 15s delay"
```

---

## Task 4: Mobile App - Install expo-notifications

**Files:**
- Working directory: `/Users/henry/Projects/grove-app`

**Step 1: Install the package**

```bash
cd /Users/henry/Projects/grove-app && npx expo install expo-notifications
```

**Step 2: Commit**

```bash
cd /Users/henry/Projects/grove-app && git add package.json bun.lockb && git commit -m "chore: add expo-notifications"
```

---

## Task 5: Mobile App - Create notifications service

**Files:**
- Create: `/Users/henry/Projects/grove-app/src/services/notifications.ts`

**Step 1: Create the notifications service file**

```typescript
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { getServerUrl } from './api'

const PUSH_TOKEN_KEY = 'grove_push_token'
const PUSH_ENABLED_KEY = 'grove_push_notifications_enabled'
const TOASTS_ENABLED_KEY = 'grove_in_app_toasts_enabled'

Notifications.setNotificationHandler({
	handleNotification: async () => ({
		shouldShowAlert: true,
		shouldPlaySound: true,
		shouldSetBadge: false,
	}),
})

export async function isPushEnabled(): Promise<boolean> {
	const value = await AsyncStorage.getItem(PUSH_ENABLED_KEY)
	return value !== 'false'
}

export async function setPushEnabled(enabled: boolean): Promise<void> {
	await AsyncStorage.setItem(PUSH_ENABLED_KEY, enabled ? 'true' : 'false')
	if (enabled) {
		await registerForPushNotifications()
	} else {
		await unregisterPushNotifications()
	}
}

export async function isToastsEnabled(): Promise<boolean> {
	const value = await AsyncStorage.getItem(TOASTS_ENABLED_KEY)
	return value !== 'false'
}

export async function setToastsEnabled(enabled: boolean): Promise<void> {
	await AsyncStorage.setItem(TOASTS_ENABLED_KEY, enabled ? 'true' : 'false')
}

export async function registerForPushNotifications(): Promise<string | null> {
	const { status: existingStatus } = await Notifications.getPermissionsAsync()
	let finalStatus = existingStatus

	if (existingStatus !== 'granted') {
		const { status } = await Notifications.requestPermissionsAsync()
		finalStatus = status
	}

	if (finalStatus !== 'granted') {
		return null
	}

	const tokenData = await Notifications.getExpoPushTokenAsync()
	const token = tokenData.data

	const serverUrl = await getServerUrl()
	if (serverUrl) {
		try {
			await fetch(`${serverUrl}/push-tokens`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					token,
					platform: Platform.OS,
				}),
			})
			await AsyncStorage.setItem(PUSH_TOKEN_KEY, token)
		} catch (err) {
			console.warn('Failed to register push token:', err)
		}
	}

	return token
}

export async function unregisterPushNotifications(): Promise<void> {
	const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY)
	if (!token) return

	const serverUrl = await getServerUrl()
	if (serverUrl) {
		try {
			await fetch(`${serverUrl}/push-tokens`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token }),
			})
		} catch (err) {
			console.warn('Failed to unregister push token:', err)
		}
	}

	await AsyncStorage.removeItem(PUSH_TOKEN_KEY)
}

export async function getStoredPushToken(): Promise<string | null> {
	return AsyncStorage.getItem(PUSH_TOKEN_KEY)
}
```

**Step 2: Commit**

```bash
cd /Users/henry/Projects/grove-app && git add src/services/notifications.ts && git commit -m "feat: add notifications service with push token management"
```

---

## Task 6: Mobile App - Create SessionToast component

**Files:**
- Create: `/Users/henry/Projects/grove-app/src/components/SessionToast.tsx`

**Step 1: Create the toast component**

```typescript
import { useEffect, useRef } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StyleSheet } from 'react-native-unistyles'
import type { Session } from '@/services/api'

type Props = {
	session: Session | null
	onPress: (session: Session) => void
	onDismiss: () => void
}

export function SessionToast({ session, onPress, onDismiss }: Props) {
	const insets = useSafeAreaInsets()
	const translateY = useRef(new Animated.Value(-100)).current
	const opacity = useRef(new Animated.Value(0)).current

	useEffect(() => {
		if (session) {
			Animated.parallel([
				Animated.spring(translateY, {
					toValue: 0,
					useNativeDriver: true,
					tension: 80,
					friction: 10,
				}),
				Animated.timing(opacity, {
					toValue: 1,
					duration: 200,
					useNativeDriver: true,
				}),
			]).start()

			const timer = setTimeout(() => {
				dismissToast()
			}, 3000)

			return () => clearTimeout(timer)
		}
	}, [session])

	const dismissToast = () => {
		Animated.parallel([
			Animated.timing(translateY, {
				toValue: -100,
				duration: 200,
				useNativeDriver: true,
			}),
			Animated.timing(opacity, {
				toValue: 0,
				duration: 200,
				useNativeDriver: true,
			}),
		]).start(() => onDismiss())
	}

	if (!session) return null

	return (
		<Animated.View
			style={[
				styles.container,
				{
					top: insets.top + 8,
					transform: [{ translateY }],
					opacity,
				},
			]}
		>
			<Pressable
				style={styles.toast}
				onPress={() => {
					dismissToast()
					onPress(session)
				}}
			>
				<View style={styles.indicator} />
				<View style={styles.content}>
					<Text style={styles.title} numberOfLines={1}>
						{session.repoName}
					</Text>
					<Text style={styles.subtitle} numberOfLines={1}>
						{session.branch} ready
					</Text>
				</View>
			</Pressable>
		</Animated.View>
	)
}

const styles = StyleSheet.create(theme => ({
	container: {
		position: 'absolute',
		left: 16,
		right: 16,
		zIndex: 1000,
	},
	toast: {
		backgroundColor: theme.colors.surface,
		borderRadius: theme.radius.md,
		flexDirection: 'row',
		alignItems: 'center',
		padding: 12,
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.15,
		shadowRadius: 12,
		elevation: 8,
	},
	indicator: {
		width: 8,
		height: 8,
		borderRadius: 4,
		backgroundColor: theme.colors.success,
		marginRight: 12,
	},
	content: {
		flex: 1,
	},
	title: {
		color: theme.colors.text,
		fontSize: 15,
		fontWeight: '600',
	},
	subtitle: {
		color: theme.colors.textSecondary,
		fontSize: 13,
		marginTop: 2,
	},
}))
```

**Step 2: Commit**

```bash
cd /Users/henry/Projects/grove-app && git add src/components/SessionToast.tsx && git commit -m "feat: add SessionToast component"
```

---

## Task 7: Mobile App - Add state transition tracking and toast trigger to api.ts

**Files:**
- Modify: `/Users/henry/Projects/grove-app/src/services/api.ts`

**Step 1: Add state change listener type and storage (after sessionsListeners around line 86)**

```typescript
type StateChangeListener = (session: Session) => void
const stateChangeListeners = new Set<StateChangeListener>()
const previousStates = new Map<string, SessionState>()
```

**Step 2: Update the SSE message handler to detect state changes (update the handler around line 106)**

Replace the existing message handler:

```typescript
eventSource.addEventListener('message', event => {
	if (!event.data) return
	try {
		const data = JSON.parse(event.data)
		if (data.type === 'sessions') {
			for (const session of data.sessions as Session[]) {
				const prev = previousStates.get(session.id)
				if (prev === 'busy' && session.state === 'waiting') {
					for (const listener of stateChangeListeners) {
						listener(session)
					}
				}
				previousStates.set(session.id, session.state)
			}
			for (const listener of sessionsListeners) {
				listener(data.sessions)
			}
		}
	} catch (e) {
		console.warn('SSE parse error:', e)
	}
})
```

**Step 3: Add subscription function for state changes (after subscribeToEvents around line 176)**

```typescript
export function subscribeToStateChanges(
	onStateChange: StateChangeListener,
): () => void {
	stateChangeListeners.add(onStateChange)
	startSSEConnection()
	return () => {
		stateChangeListeners.delete(onStateChange)
		if (
			connectionListeners.size === 0 &&
			sessionsListeners.size === 0 &&
			stateChangeListeners.size === 0
		) {
			stopSSEConnection()
		}
	}
}
```

**Step 4: Update stopSSEConnection check in other unsubscribe functions**

Update the return function in `subscribeToConnection` (around line 159):
```typescript
return () => {
	connectionListeners.delete(listener)
	if (
		connectionListeners.size === 0 &&
		sessionsListeners.size === 0 &&
		stateChangeListeners.size === 0
	) {
		stopSSEConnection()
	}
}
```

Update the return function in `subscribeToEvents` (around line 170):
```typescript
return () => {
	sessionsListeners.delete(onSessions)
	if (
		connectionListeners.size === 0 &&
		sessionsListeners.size === 0 &&
		stateChangeListeners.size === 0
	) {
		stopSSEConnection()
	}
}
```

**Step 5: Commit**

```bash
cd /Users/henry/Projects/grove-app && git add src/services/api.ts && git commit -m "feat: add state change tracking for in-app toasts"
```

---

## Task 8: Mobile App - Add notification handling and toast to _layout.tsx

**Files:**
- Modify: `/Users/henry/Projects/grove-app/src/app/_layout.tsx`

**Step 1: Add imports (at the top of the file)**

Add these imports:
```typescript
import * as Notifications from 'expo-notifications'
import { SessionToast } from '@/components/SessionToast'
import {
	isPushEnabled,
	isToastsEnabled,
	registerForPushNotifications,
} from '@/services/notifications'
import { subscribeToStateChanges, type Session } from '@/services/api'
```

**Step 2: Add toast state and notification handlers to RootLayout (inside the component, after the existing useEffect hooks around line 149)**

```typescript
const [toastSession, setToastSession] = useState<Session | null>(null)

useEffect(() => {
	isPushEnabled().then(enabled => {
		if (enabled) {
			registerForPushNotifications()
		}
	})

	const notificationSubscription =
		Notifications.addNotificationResponseReceivedListener(response => {
			const sessionId = response.notification.request.content.data?.sessionId
			if (sessionId && typeof sessionId === 'string') {
				router.push(`/sessions/${sessionId}`)
			}
		})

	return () => {
		notificationSubscription.remove()
	}
}, [])

useEffect(() => {
	const unsubscribe = subscribeToStateChanges(async session => {
		const toastsEnabled = await isToastsEnabled()
		if (toastsEnabled) {
			setToastSession(session)
		}
	})
	return unsubscribe
}, [])

const handleToastPress = useCallback((session: Session) => {
	router.push(`/sessions/${session.id}`)
}, [])

const handleToastDismiss = useCallback(() => {
	setToastSession(null)
}, [])
```

**Step 3: Add useCallback import if not present**

Update the react import at the top:
```typescript
import { useCallback, useEffect, useState } from 'react'
```

**Step 4: Add SessionToast to the render (inside the return, after StatusBar around line 160)**

Add right after the StatusBar component:
```typescript
<SessionToast
	session={toastSession}
	onPress={handleToastPress}
	onDismiss={handleToastDismiss}
/>
```

**Step 5: Commit**

```bash
cd /Users/henry/Projects/grove-app && git add src/app/_layout.tsx && git commit -m "feat: add push notification handling and in-app toasts"
```

---

## Task 9: Mobile App - Add notification settings to SettingsContent

**Files:**
- Modify: `/Users/henry/Projects/grove-app/src/components/SettingsContent.tsx`

**Step 1: Add imports for notification functions (at the top with other imports)**

```typescript
import {
	isPushEnabled,
	isToastsEnabled,
	setPushEnabled,
	setToastsEnabled,
} from '@/services/notifications'
```

**Step 2: Add state for notification settings (after skipPermissions state around line 90)**

```typescript
const [pushEnabled, setPushEnabledState] = useState(true)
const [toastsEnabled, setToastsEnabledState] = useState(true)
```

**Step 3: Load notification settings in useEffect (add to the existing useEffect around line 94)**

Add these lines inside the existing useEffect:
```typescript
isPushEnabled().then(setPushEnabledState)
isToastsEnabled().then(setToastsEnabledState)
```

**Step 4: Add handlers for notification toggles (after handleSkipPermissions around line 174)**

```typescript
const handlePushEnabled = useCallback((value: boolean) => {
	setPushEnabledState(value)
	setPushEnabled(value)
}, [])

const handleToastsEnabled = useCallback((value: boolean) => {
	setToastsEnabledState(value)
	setToastsEnabled(value)
}, [])
```

**Step 5: Add notification settings section UI (after the CLAUDE CODE section, around line 238)**

Add this new section before the SUBSCRIPTION section:
```typescript
<Text style={styles.sectionHeader}>NOTIFICATIONS</Text>
<View style={styles.section}>
	<View style={styles.row}>
		<View style={styles.rowLeft}>
			<Ionicons
				name="notifications-outline"
				size={20}
				color={styles.rowIconColor.color}
				style={styles.rowIcon}
			/>
			<Text style={styles.rowLabel}>Push Notifications</Text>
		</View>
		<Switch
			value={pushEnabled}
			onValueChange={handlePushEnabled}
			trackColor={{
				false: styles.switchTrack.color,
				true: styles.switchTrackActive.color,
			}}
			thumbColor="#FFFFFF"
		/>
	</View>
	<View style={styles.separator} />
	<View style={styles.row}>
		<View style={styles.rowLeft}>
			<Ionicons
				name="chatbox-outline"
				size={20}
				color={styles.rowIconColor.color}
				style={styles.rowIcon}
			/>
			<Text style={styles.rowLabel}>In-App Toasts</Text>
		</View>
		<Switch
			value={toastsEnabled}
			onValueChange={handleToastsEnabled}
			trackColor={{
				false: styles.switchTrack.color,
				true: styles.switchTrackActive.color,
			}}
			thumbColor="#FFFFFF"
		/>
	</View>
</View>
```

**Step 6: Commit**

```bash
cd /Users/henry/Projects/grove-app && git add src/components/SettingsContent.tsx && git commit -m "feat: add notification settings toggles"
```

---

## Task 10: Final verification and cleanup

**Step 1: Run biome check on server**

```bash
cd /Users/henry/.claude-worktrees/grove/feat-mobile-notifications && bunx biome check --write .
```

**Step 2: Run biome check on mobile app**

```bash
cd /Users/henry/Projects/grove-app && bunx biome check --write .
```

**Step 3: Start server and verify it runs**

```bash
cd /Users/henry/.claude-worktrees/grove/feat-mobile-notifications && bun run dev
```

Expected: Server starts without errors

**Step 4: Commit any formatting fixes**

```bash
cd /Users/henry/.claude-worktrees/grove/feat-mobile-notifications && git add -A && git diff --cached --quiet || git commit -m "style: format code"
cd /Users/henry/Projects/grove-app && git add -A && git diff --cached --quiet || git commit -m "style: format code"
```
