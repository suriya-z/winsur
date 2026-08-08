# Winsur

**Winsur** — multi-agent control surface for Windows.  
Run AI coding agents in the background; get interrupted only when they need you.

Inspired by [Vibe Island](https://vibeisland.app) (macOS). Built for Windows with Electron.

## Path

```
C:\Users\acer\Winsur
```

## Quick start

```powershell
cd C:\Users\acer\Winsur
npm install
npm start
```

## Desktop app

```powershell
cd C:\Users\acer\Winsur
npm run dist
```

Output in `release\`:

- `Winsur-Setup-0.1.0.exe`
- `Winsur-Portable-0.1.0.exe`

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

## Config

| Path | Role |
|------|------|
| `C:\Users\acer\Winsur\hooks\` | Hook scripts (source of truth) |
| `~/.winsur\` | Settings, SSH remotes |
| `~/.grok\hooks\winsur.json` | Generated Grok hooks |

## License

MIT
