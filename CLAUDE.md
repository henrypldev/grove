# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Klaude is a mobile app (Expo/React Native) + backend server (Bun) for managing Git repositories and terminal sessions from a mobile device. It integrates with Git worktrees and uses TTYD for web-based terminal access.

## Commands

### Development
```bash
bun run dev          # Start server with watch mode
bun run mobile       # Start Expo dev server
bun run server       # Start server (production)
```

### Mobile App
```bash
bun run --cwd mobile ios      # Build for iOS
bun run --cwd mobile android  # Build for Android
```

### Linting/Formatting
Biome handles linting and formatting. Run from root:
```bash
bunx biome check .            # Check for issues
bunx biome check --write .    # Fix issues
```

## Architecture

### Monorepo Structure
- **mobile/** - Expo React Native app with file-based routing (Expo Router)
- **server/** - Bun HTTP server providing REST API

### Mobile App (`mobile/src/`)
- **app/** - Expo Router screens (file-based routing)
  - `index.tsx` - Home screen (sessions list)
  - `settings.tsx` - Server/terminal configuration
  - `new-session.tsx` - Multi-step session creation flow
  - `repos/` - Repository management
  - `sessions/[id].tsx` - Terminal viewer (WebView to ttyd)
- **services/api.ts** - API client wrapper

Path aliases: `@/*` → `src/*`, `@/assets` → `assets/*`

### Server (`server/src/`)
- **index.ts** - Main server with REST endpoints
- **api/** - Business logic (repos, sessions, worktrees)
- **terminal/ttyd.ts** - TTYD process management
- **config/** - JSON file persistence (~/.config/klaude/)

### Server API Endpoints
- `GET/POST/DELETE /repos` - Repository management
- `GET/POST/DELETE /sessions` - Terminal session management
- `GET/POST /worktrees/:repoId` - Git worktree operations

### Terminal Integration
Sessions spawn TTYD + tmux with Claude CLI. Each session is a tmux session accessible via web terminal.

## Styling

Terminal dark theme: black background (#000000), white text (#FFFFFF), green accent (#00FF00). Uses React Native Unistyles with SpaceMono font.

## Network

Uses Tailscale: Funnel for API access, direct Tailscale IP (100.97.255.91) for terminal connections.
