# Vibe Island Win

> Windows Dynamic Island for AI Coding Agents — monitor, approve, and jump to your AI agents from a single floating panel.

Inspired by [Vibe Island (macOS)](https://vibeisland.app) and [open-vibe-island](https://github.com/Octane0411/open-vibe-island). Built from scratch for Windows with Tauri v2.

## Features

- **Dynamic Island UI** — Floating capsule at screen top, expands on click with spring animations
- **Multi-Agent Monitoring** — Real-time status for Claude Code, Codex, Cursor, Antigravity, and more
- **Permission Approval** — Allow/Deny agent tool requests with keyboard shortcuts (Enter/Esc)
- **Question Reply** — Reply to agent questions directly from the panel
- **Window Jump** — Click an agent card to focus its terminal/IDE window (Win32 API)
- **System Tray** — Minimize to tray, right-click menu for show/hide/exit
- **Windows Toast Notifications** — Native notifications when agents need attention
- **Auto Hook Setup** — One-click hook installation for 10 supported agents
- **Nord Macaron Theme** — Soft, eye-friendly color palette

## Supported Agents

| Agent | Type | Hook Method |
|-------|------|-------------|
| Claude Code CLI | Terminal | HTTP hooks via `~/.claude/settings.json` |
| Codex CLI | Terminal | Command hooks via `~/.codex/hooks.json` |
| Claude Desktop | Desktop App | Shared Claude Code hooks |
| Cursor | IDE | HTTP hooks |
| Antigravity | Desktop App | HTTP hooks |
| OpenCode | Terminal | HTTP hooks |
| Qwen Code | Terminal | HTTP hooks |
| CodeBuddy | Terminal | HTTP hooks |
| Windsurf | IDE | HTTP hooks |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Desktop Framework | Tauri v2 (Rust + WebView2) |
| Frontend | React 19 + TypeScript + Vite |
| Animation | Motion (Framer Motion) |
| Styling | Tailwind CSS v4 |
| Icons | Custom SVG + Lucide React |
| HTTP Server | axum 0.8 |
| State | Zustand |
| Notifications | winrt-toast |
| Window Management | Win32 API (windows crate) |

## Quick Start

### Prerequisites

- Node.js 20+
- Rust 1.80+
- Windows 10 (1903+) or Windows 11

### Development

```bash
npm install
npm run tauri:dev
```

### Build

```bash
npm run tauri:build
```

Outputs:
- `src-tauri/target/release/bundle/msi/` — MSI installer
- `src-tauri/target/release/bundle/nsis/` — NSIS installer

## How It Works

```
AI Agent (Claude Code / Codex / ...)
  │ HTTP POST http://localhost:18900/hooks/event
  ▼
axum HTTP Server (Rust backend)
  │ Parse event → Update SessionManager
  ▼
Tauri IPC emit("agent-update")
  │
  ▼
React Frontend (Zustand store → Motion animations)
  │ Auto-expand on permission/question events
  ▼
Dynamic Island UI
```

### Hook Configuration

Claude Code hooks are configured in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{ "type": "http", "url": "http://127.0.0.1:18900/hooks/event", "timeout": 5 }],
    "PostToolUse": [{ "type": "http", "url": "http://127.0.0.1:18900/hooks/event", "timeout": 5 }],
    "Stop": [{ "type": "http", "url": "http://127.0.0.1:18900/hooks/event", "timeout": 5 }]
  }
}
```

Use the Settings panel in the app to install hooks automatically.

## Project Structure

```
src/                          # React frontend
  components/
    Island/                   # Dynamic Island (collapsed/expanded views)
    Agent/                    # Agent cards, permission UI, question reply
    Settings/                 # Hook configuration panel
    shared/                   # AgentIcon SVG, StatusDot
  stores/agentStore.ts        # Zustand state management
  hooks/                      # useAgentEvents, useKeyboardShortcuts
  types/agent.ts              # TypeScript type definitions

src-tauri/src/                # Rust backend
  lib.rs                      # App entry + system tray setup
  server.rs                   # HTTP hook server (axum)
  agent.rs                    # Session manager + event handling
  commands.rs                 # Tauri IPC commands
  window.rs                   # Win32 window focus management
  notify.rs                   # Windows Toast notifications
  hook_installer.rs           # Auto hook configuration

hooks/                        # PowerShell hook scripts for agents
  vibe-island-hook.ps1        # Universal hook forwarder
  vibe-island-hook.cmd        # CMD wrapper

output/                       # Design documents
  *-prd.md                    # Product requirements
  *-architecture.md           # Architecture design
  *-uiux.md                   # UI/UX specification
```

## Debug

Visit `http://localhost:18900/debug/events` to see all received hook events.

## License

MIT
