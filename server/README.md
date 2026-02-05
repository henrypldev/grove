# Grove Server

The Grove server manages development sessions, git worktrees, and provides a terminal interface.

## Setup Steps

You can configure automatic setup steps that run when a session starts by creating a `.grove/setup.json` file in your repository root.

### Configuration

Create `.grove/setup.json` in your project:

```json
{
  "setup": [
    {
      "name": "Install dependencies",
      "run": "npm install"
    },
    {
      "name": "Build project",
      "run": "npm run build"
    }
  ]
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `setup` | array | List of setup steps to run in order |
| `setup[].name` | string | Display name shown in the UI |
| `setup[].run` | string | Shell command to execute |

### Behavior

- Steps run sequentially in the worktree directory
- Each step shows real-time status (pending, running, done, failed)
- If a step fails, subsequent steps are skipped
- You can cancel running steps or retry failed ones from the UI
- Output from each step is captured and viewable in the setup inspector

### Example for React Native / Expo

```json
{
  "setup": [
    {
      "name": "Install dependencies",
      "run": "npm install"
    },
    {
      "name": "Install pods",
      "run": "cd ios && pod install"
    },
    {
      "name": "Build iOS",
      "run": "npx expo run:ios"
    }
  ]
}
```
