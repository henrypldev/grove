# Grove

Server and CLI for managing Git repositories and terminal sessions from your phone. Run Claude Code sessions on your dev machine, access them from anywhere.

## Requirements

- [Bun](https://bun.sh)
- [Tailscale](https://tailscale.com) with Funnel enabled
- [ttyd](https://github.com/tsl0922/ttyd) - `brew install ttyd`
- [tmux](https://github.com/tmux/tmux) - `brew install tmux`

## Installation

### Homebrew (recommended)

```bash
brew tap henrypl/grove
brew install grove
```

### From source

```bash
git clone https://github.com/henrypl/grove.git
cd grove
bun install
```

## Usage

### Start the server

```bash
grove                    # Start server (interactive)
grove -b                 # Start in background
grove --port 3001        # Custom port
grove --stop             # Stop background server
```

### CLI Options

```
-b, --background    Start server in background
-h, --help          Show help message
--port <number>     Set server port (default: 3000)
--stop, stop        Stop background server and kill all sessions
```

## How it works

1. **grove CLI** starts the server and sets up a Tailscale Funnel for external access
2. **grove server** exposes a REST API for managing repos, worktrees, and terminal sessions
3. **Terminal sessions** are tmux sessions running Claude Code, served via ttyd over HTTPS
4. **Grove mobile app** (separate repo) connects to the server to create and manage sessions

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
| GET | `/events` | SSE stream for real-time updates |

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
