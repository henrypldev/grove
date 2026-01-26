# Sessions List Redesign

Redesign the sessions home screen to match Tailscale's clean list UI style.

## Header

```
┌─────────────────────────────────────────┐
│  macbook.tail1234.ts.net                │
│  Connected · 3 active                   │
└─────────────────────────────────────────┘
```

- **Primary text**: Server URL domain (without protocol)
- **Secondary text**: Connection status + active session count
- Connection status: "Connected" (green) / "Disconnected" (red)
- Status determined by lightweight health check on focus/refresh

## Session List

```
┌─────────────────────────────────────────┐
│  🔍 Search...                           │
├─────────────────────────────────────────┤
│  ● cora · feat/my-branch              › │
├─────────────────────────────────────────┤
│  ● klaude · main                      › │
├─────────────────────────────────────────┤
│    klaude · feat/old-branch           › │
└─────────────────────────────────────────┘
```

- **Search bar**: Rounded input, filters on both repo name and branch name
- **Session rows**:
  - Green dot for active sessions, empty space for inactive
  - Format: `repo · branch` (middle dot separator)
  - Chevron on right
  - Subtle separators between rows
- Pull-to-refresh for manual refresh
- FAB (+) button remains for creating new sessions

## Changes Required

1. Add header component with server URL and connection status
2. Add search bar with filtering logic
3. Update session row styling:
   - Remove card styling, use flat list rows with separators
   - Add chevron icon
   - Change format to `repo · branch`
   - Move green dot to left side
