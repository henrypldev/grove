# Native Tabs UI Redesign

## Overview

Redesign the Klaude mobile app from a terminal aesthetic to a clean, modern iOS app using native bottom tabs.

## Navigation Structure

```
app/
├── _layout.tsx          # Root layout (handles modals, setup)
├── (tabs)/
│   ├── _layout.tsx      # NativeTabs configuration
│   ├── index.tsx        # Sessions tab
│   ├── repos.tsx        # Repos tab
│   └── settings.tsx     # Settings tab
├── sessions/
│   └── [id].tsx         # Terminal view (pushed)
├── new-session.tsx      # Modal
├── repos/
│   └── add.tsx          # Modal
└── setup.tsx            # Deep link handler
```

## Visual Theme

### Colors (Dark Mode Only)

| Token | Value | Usage |
|-------|-------|-------|
| Background | #0A0A0A | Main background |
| Surface | #1C1C1E | Cards, inputs |
| Surface Elevated | #2C2C2E | Modals |
| Border | #38383A | Subtle separators |
| Text Primary | #FFFFFF | Main text |
| Text Secondary | #8E8E93 | Labels, hints |
| Text Tertiary | #636366 | Placeholders |
| Accent | #0A84FF | Tappable elements |
| Destructive | #FF453A | Delete actions |
| Success | #30D158 | Connected status |

### Typography

- System font (SF Pro) for UI
- Monospace only for code/terminal content (branch names, paths)

### Components

- Cards: Surface background, 12px radius, flat (no shadows)
- Buttons: Filled accent for primary, text-only for secondary
- Inputs: Surface background, subtle border, 8px radius
- Lists: Native iOS grouped style

## Screens

### Sessions Tab

- Header: "Sessions" + plus button (unstable_headerRightItems)
- Empty state: "No active sessions"
- List: Cards with branch name (mono) and repo name
- Pull to refresh
- Tap opens terminal view

### Repos Tab

- Header: "Repos" + plus button
- Empty state: "No repos added"
- List: Cards with repo name and path (mono)
- Swipe to delete

### Settings Tab

- Header: "Settings"
- Grouped sections:
  - Server: URL and Terminal Host configuration
  - About: Version info

### Modals

- New Session: Multi-step flow (select repo → select branch → start)
- Add Repo: Single screen with path input

## Implementation Notes

- Use `expo-router/unstable-native-tabs` for NativeTabs
- Use `unstable_headerRightItems` for header actions with SF Symbols
- Keep terminal view shortcuts bar but update styling
