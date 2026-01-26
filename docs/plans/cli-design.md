# grove CLI Design

A CLI package that provides an interactive setup wizard and runs the grove server with automatic Tailscale Funnel configuration.

## User Flow

```
$ grove

Checking dependencies...
✓ ttyd found
✓ tmux found
✓ tailscale found

Starting server on port 3000...
Setting up Tailscale Funnel...

✓ grove running at: https://mac-studio.tailnet.ts.net/grove
  Scan QR code in app or enter URL manually.

[QR CODE]

Press Ctrl+C to stop
```

## Dependency Installation

When dependencies are missing, prompt to install via Homebrew (macOS only):

```
Checking dependencies...
✓ tmux found
✗ ttyd not found
✗ tailscale not found

? Install missing dependencies?
  > Yes, install ttyd and tailscale
    No, show me the commands

Installing ttyd...
✓ ttyd installed

Installing tailscale...
✓ tailscale installed

? Tailscale needs to be running. Open Tailscale app now?
  > Yes
    No, I'll do it myself
```

## Port Configuration

Order of precedence:
1. CLI flag: `grove --port 3001`
2. Saved config from previous run
3. Default: 3000

Config saved to `~/.config/grove/cli.json`.

## Tailscale Funnel

URL format: `https://{machine}.{tailnet}.ts.net/grove`

Uses path-based routing to keep root URL available for other uses.

### On Start

1. Start server on `localhost:{port}`
2. Run: `tailscale funnel --bg --set-path /grove localhost:{port}`
3. Get hostname from: `tailscale status --json`
4. Display URL with QR code

### On Stop (Ctrl+C)

1. Run: `tailscale funnel --set-path /grove off`
2. Stop server

## CLI Interface

```
grove                  # Interactive start
grove --port 3001      # Override port
```

## Package Structure

```
cli/
├── package.json
├── src/
│   ├── index.tsx          # Entry point, Ink app
│   ├── components/
│   │   ├── Setup.tsx      # Port selection (if not provided)
│   │   ├── DepsCheck.tsx  # Dependency checker/installer
│   │   └── Running.tsx    # Running state (URL, QR code)
│   ├── tunnel.ts          # Tailscale Funnel logic
│   ├── deps.ts            # Homebrew install helpers
│   └── config.ts          # Save/load CLI config
└── build.ts               # Bun compile script
```

## Dependencies

- `ink` + `react` - CLI UI framework
- `qrcode-terminal` - QR code generation

## Future Scope (not in MVP)

- ngrok and Cloudflare Tunnel support
- `grove stop` command
- TUI dashboard with session management
- Multi-instance support
- Linux/Windows support
