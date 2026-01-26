# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Grove is a server and CLI for managing Git repositories and terminal sessions from a mobile device. It integrates with Git worktrees and uses TTYD for web-based terminal access.

## Commands

### Development
```bash
bun run dev          # Start server with watch mode
bun run server       # Start server (production)
bun run cli          # Run CLI in dev mode
```

### Linting/Formatting
Biome handles linting and formatting. Run from root:
```bash
bunx biome check .            # Check for issues
bunx biome check --write .    # Fix issues
```

### Release
```bash
bun scripts/release-server.ts patch|minor|major
```

## Architecture

### Structure
- **server/** - Bun HTTP server providing REST API
- **cli/** - Command-line interface for setup and management

### Server (`server/src/`)
- **index.ts** - Main server with REST endpoints
- **api/** - Business logic (repos, sessions, worktrees)
- **terminal/ttyd.ts** - TTYD process management
- **config/** - JSON file persistence (~/.config/grove/)

### CLI (`cli/src/`)
- Interactive setup and management tool using Ink (React for CLI)

### Server API Endpoints
- `GET/POST/DELETE /repos` - Repository management
- `GET/POST/DELETE /sessions` - Terminal session management
- `GET/POST /worktrees/:repoId` - Git worktree operations

### Terminal Integration
Sessions spawn TTYD + tmux with Claude CLI. Each session is a tmux session accessible via web terminal.

## Network

Uses Tailscale: Funnel for API access, direct Tailscale IP for terminal connections.
