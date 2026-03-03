# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
```bash
bun run dev          # Start server with watch mode
bun run server       # Start server (production)
bun run cli          # Run CLI in dev mode (e.g., bun run cli start -b)
```

### Testing
```bash
bun run test         # Run server tests
```

### Linting/Formatting
Biome handles linting and formatting. Run from root:
```bash
bunx biome check .            # Check for issues
bunx biome check --write .    # Fix issues
```

### Release
```bash
bun scripts/release.ts patch|minor|major
```

## Architecture

Flat repo structure (no workspaces).

- `src/server/` — Grove server
- `src/cli/` — CLI tool (imports server directly)
- `src/shared/` — Shared types
- `docs/` — Documentation (separate Next.js app)
- `drizzle/` — Database migrations
- `simulator-server/` — Swift simulator server

SDK is in a separate repo: `grove-sdk` (`@usegrove/sdk`).

## Network

Uses Tailscale: Funnel for API access, direct Tailscale IP for terminal connections.
