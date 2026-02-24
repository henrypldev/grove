# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
```bash
bun run dev          # Start server with watch mode
bun run server       # Start server (production)
bun run cli          # Run CLI in dev mode (e.g., bun run cli start -b)
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

## Network

Uses Tailscale: Funnel for API access, direct Tailscale IP for terminal connections.
