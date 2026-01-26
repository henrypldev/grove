# grove Design Document

Remote Claude Code session manager for iOS/Android.

## Overview

grove is a mobile app that lets you remotely control Claude Code sessions running on your laptop. It uses ttyd for terminal streaming over WebSocket and a Bun server for session/worktree management.

## Architecture

```
┌─────────────────┐     Tailscale      ┌─────────────────┐
│   Mobile App    │ ◄────────────────► │  Laptop Server  │
│  (Expo + RN)    │                    │     (Bun)       │
└─────────────────┘                    └────────┬────────┘
        │                                       │
        │ WebSocket                             │ spawns
        ▼                                       ▼
┌─────────────────┐                    ┌─────────────────┐
│   xterm.js      │ ◄────────────────► │      ttyd       │
│   (WebView)     │     WebSocket      │   (per session) │
└─────────────────┘                    └────────┬────────┘
                                                │
                                                ▼
                                       ┌─────────────────┐
                                       │  tmux + claude  │
                                       │   (in worktree) │
                                       └─────────────────┘
```

## Decisions

| Aspect | Decision |
|--------|----------|
| Structure | `grove/mobile` + `grove/server` monorepo |
| Server | Bun + REST API + ttyd process management |
| Terminal | ttyd WebSocket → xterm.js in WebView |
| Sessions | Multi-session with list/drawer |
| Worktrees | Guided creation (repo, branch, base) |
| Repos | Manual add through app UI |
| Auth | Tailscale-only (trust the network) |
| Config | XDG-compliant (`~/.config/grove/`) |
| Input | Text field + sticky shortcuts above keyboard |
| UI | Terminal aesthetic: mono font, black/white, sharp corners |

## Server API

### Repos
- `GET /repos` - List registered repos
- `POST /repos` - Add repo `{ path: string }`
- `DELETE /repos/:id` - Remove repo

### Sessions
- `GET /sessions` - List active sessions
- `POST /sessions` - Create session `{ repoId: string, worktree: string }`
- `DELETE /sessions/:id` - Kill session

### Worktrees
- `GET /worktrees/:repoId` - List worktrees for repo
- `POST /worktrees` - Create worktree `{ repoId: string, branch: string, baseBranch: string }`

## Mobile Screens

- `/` - Home: session list, new session button, settings
- `/sessions/[id]` - Terminal view with input bar
- `/repos` - Repo management
- `/repos/add` - Add repo modal
- `/new-session` - Create session flow (repo → worktree)
- `/settings` - Server URL configuration

## Dependencies

### Mobile
- Expo SDK 55 beta
- expo-router
- react-native-unistyles
- react-native-keyboard-controller
- react-native-webview
- @react-native-async-storage/async-storage

### Server
- Bun runtime
- ttyd (system dependency)
- tmux (system dependency)

## Setup

1. Install system dependencies:
   ```bash
   brew install ttyd tmux
   ```

2. Start server:
   ```bash
   cd server && bun run start
   ```

3. Configure Tailscale on both devices

4. Open mobile app, enter Tailscale IP in settings

5. Add repos and create sessions
