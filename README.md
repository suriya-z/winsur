# Winsur

**Winsur** — multi-agent control surface for Windows.  
Run AI coding agents in the background; get interrupted only when they need you.

Inspired by [Vibe Island](https://vibeisland.app) (macOS). Built for Windows with Electron.

## Quick start

```powershell
npm install
npm start
```

## Desktop app

```powershell
npm run dist
```

Output in `release\`:

- `Winsur-Setup-0.1.1.exe`
- `Winsur-Portable-0.1.1.exe`

## Commands

| Command | What |
|---------|------|
| `npm start` | Dev mode |
| `npm run free` | Free ports 1420 / 18900 |
| `npm run restart` | Free ports + start |
| `npm run dist` | Build Windows installer |

## Features

- Zero-config hooks for many agents (Claude, Codex, Grok Build, Cursor, …)
- Permission Allow / Deny, optional terminal reply, window jump
- Plan review (Markdown + approve / feedback)
- Sound alerts, usage panel, SSH reverse tunnels
- Fully local — hook server on `127.0.0.1:18900`

## Permissions

`Bash`, `Write`, `Edit` and `NotebookEdit` are held until you answer;
the agent waits up to 5 minutes, then denies. Everything else is
reported for display and falls through to the agent's own permission
prompt.

Holding a tool call requires knowing how a given agent reads a hook's
decision, so gating is currently enabled for Claude Code only. Other
agents show activity, questions and plans, but Winsur does not decide
for them. To gate another host, add it in `electron/hooks.cjs`
(`GATED_TOOLS`, and the `gate` flag in `installAllHooks`).

## Config

| Path | Role |
|------|------|
| `hooks\` | Hook scripts (source of truth) |
| `~/.winsur\` | Settings, SSH remotes |
| `~/.grok\hooks\winsur.json` | Generated Grok hooks |

## License

MIT
