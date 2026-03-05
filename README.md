# Grove

Server and CLI for managing Git repositories and terminal sessions from your phone. Run Claude Code sessions on your dev machine, access them from anywhere.

## Requirements

- macOS
- [Bun](https://bun.sh)
- [Tailscale](https://tailscale.com) with Funnel enabled
- [ttyd](https://github.com/tsl0922/ttyd) - `brew install ttyd`
- [tmux](https://github.com/tmux/tmux) - `brew install tmux`

## Installation

### Homebrew (recommended)

```bash
brew tap henrypldev/grove
brew install grove
```

### From source

```bash
git clone https://github.com/henrypldev/grove.git
cd grove
bun install
```

## Tailscale Setup

Grove uses [Tailscale](https://tailscale.com) to securely connect your phone to your dev machine. Both devices must be on the same Tailscale network (tailnet). Only devices in your tailnet can access Grove — no ports are exposed to the public internet.

### 1. Create a Tailscale account

Sign up at [login.tailscale.com](https://login.tailscale.com) if you don't have an account.

### 2. Install Tailscale on your Mac (server machine)

```bash
brew install --cask tailscale
```

Open the Tailscale app and sign in. Verify it's running:

```bash
tailscale status
```

You should see your machine listed with a `100.x.x.x` IP address.

### 3. Install Tailscale on your phone

Download [Tailscale from the App Store](https://apps.apple.com/app/tailscale/id1470499037) and sign in with the **same account** you used on your Mac. Both devices must be on the same tailnet.

### 4. Enable HTTPS Certificates

Go to the [DNS page](https://login.tailscale.com/admin/dns) in the admin console. Enable **MagicDNS** if it isn't already on, then under **HTTPS Certificates**, click **Enable HTTPS**. Grove uses these certificates to serve terminal sessions over secure HTTPS connections.

### 5. Enable Funnel

The first time you run `grove start`, it runs `tailscale funnel` which will prompt you to approve Funnel for your tailnet. You can also enable it manually in the [Access controls page](https://login.tailscale.com/admin/acls) — expand the **Funnel** section and click **Add Funnel to policy**. Grove uses Funnel to expose its API endpoint so the mobile app can reach your server.

### 6. Verify the connection

On your phone, open the Tailscale app and confirm it shows **Connected**. You should see your Mac listed as a peer. On your Mac, run:

```bash
tailscale status
```

Both your Mac and phone should appear in the output.

### How Grove uses Tailscale

- **API access**: Grove sets up a Tailscale Funnel at `https://<your-machine>.tail-net.ts.net/grove` so the mobile app can reach the server.
- **Terminal sessions**: Each session runs on its own HTTPS port using Tailscale certificates, accessible at `https://<your-machine>.tail-net.ts.net:<port>`.
- **Authentication**: Only devices on your tailnet can connect. No passwords or API keys needed — Tailscale handles identity.

### Troubleshooting

| Problem | Solution |
|---------|----------|
| `grove start` says Tailscale isn't running | Open the Tailscale app on your Mac, or run `open -a Tailscale` |
| Can't see sessions from phone | Make sure Tailscale is **connected** on your phone (not just installed) and you're signed into the **same account** |
| Funnel setup fails | Check that Funnel is enabled in the [Access controls page](https://login.tailscale.com/admin/acls) under the Funnel section |
| Certificate errors | Ensure MagicDNS and HTTPS are both enabled on the [DNS page](https://login.tailscale.com/admin/dns). Test with `tailscale cert <your-hostname>` |
| Phone shows "unable to connect" | Verify both devices appear in `tailscale status`. Try toggling Tailscale off/on on your phone |

## Usage

### Start the server

```bash
grove start              # Start server (interactive)
grove start -b           # Start in background
grove start --port 3001  # Custom port
grove stop               # Stop background server
```

### Run a command with mobile access

```bash
grove run claude     # Run Claude Code in a tmux+ttyd session accessible over Tailscale
```

This launches the command in the current directory, sets up a secure terminal session, and prints the HTTPS URL you can open from your phone (both devices must be on the same tailnet).

### CLI Options

```
-b, --background    Start server in background
-h, --help          Show help message
--port <number>     Set server port (default: random available port)
```

## How it works

1. **grove CLI** starts the server and sets up a Tailscale Funnel for API access
2. **grove server** exposes a REST API for managing repos, worktrees, and terminal sessions
3. **Terminal sessions** are tmux sessions running Claude Code, served via ttyd over HTTPS using Tailscale certificates
4. **Grove mobile app** connects to the server over your tailnet to create and manage sessions

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/repos` | List registered repositories |
| POST | `/repos` | Add a repository |
| DELETE | `/repos/:id` | Remove a repository |
| GET | `/sessions` | List active terminal sessions |
| POST | `/sessions` | Create a new session |
| DELETE | `/sessions/:id` | Kill a session |
| GET | `/worktrees/:repoId` | List worktrees for a repo |
| POST | `/worktrees` | Create a new worktree |
| DELETE | `/worktrees` | Delete a worktree |
| GET | `/activity` | stream for real-time activity |

## Environment Files

When creating a new worktree, Grove automatically copies untracked `.env*` files (e.g. `.env.local`, `.env.development.local`) from the repository root into the new worktree. This ensures new worktrees have the same environment configuration as the main working directory without manual setup.

## Configuration

Config is stored in `~/.config/grove/`:

- `config.json` - Registered repositories
- `sessions.json` - Active session state

## Development

```bash
bun run dev      # Start server with watch mode
bun run cli      # Run CLI in dev mode
```

## License

MIT
