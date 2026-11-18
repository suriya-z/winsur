# Winsur

**Winsur** — multi-agent control surface for Windows.
Run AI coding agents in the background; get interrupted only when they need you.

Inspired by [Vibe Island](https://vibeisland.app) (macOS). Built for Windows with Electron.

<!-- TODO: screenshot / GIF of the island expanded with a permission card goes here -->

## Download

**[Download the latest release →](https://github.com/suriya-z/winsur/releases/latest)**

| File | Use |
|------|-----|
| `Winsur-Setup-*.exe` | Installer — adds Start Menu and desktop shortcuts |
| `Winsur-Portable-*.exe` | Single executable, no install |

Windows 10/11, x64. You do not need to clone this repo or install Node to use
Winsur — the source is here to read, fork and contribute to.

### The installer is unsigned

Winsur is not code-signed yet, so Windows will show
**"Windows protected your PC"** with an unknown publisher. To continue, click
**More info**, then **Run anyway**. This is expected for unsigned open-source
software; the alternative is a paid certificate. If you would rather not
click through that, build from source instead (below) — same result.

## What it does

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

## What Winsur touches on your machine

Worth knowing before you run it:

- **It edits your agents' config files.** On launch Winsur installs its hooks
  into the settings of every agent it detects — for example
  `~/.claude/settings.json` and `~/.grok/hooks/winsur.json`. Existing hooks are
  preserved; only Winsur's own entries are rewritten. See `electron/hooks.cjs`.
- **It runs a local HTTP server** on `127.0.0.1:18900` to receive hook events.
  It binds to loopback only and sends no CORS headers, so a web page you visit
  cannot read from it.
- **Nothing leaves your machine.** There is no telemetry and no remote endpoint.
  Agent activity stays in memory and in `~/.winsur\`.
- **It can focus windows and send keystrokes.** "Jump to terminal" and terminal
  replies use PowerShell and Win32 calls to target the agent's window. See
  `hooks\` and the focus logic in `electron/`.

## Build from source

```powershell
npm install
npm start
```

Build the installers yourself:

```powershell
npm run dist
```

Output lands in `release\`.

| Command | What |
|---------|------|
| `npm start` | Dev mode |
| `npm run free` | Free ports 1420 / 18900 |
| `npm run restart` | Free ports + start |
| `npm run dist` | Build Windows installers |
| `npm run lint` | ESLint |

## Config

| Path | Role |
|------|------|
| `hooks\` | Hook scripts (source of truth) |
| `~/.winsur\` | Settings, SSH remotes |
| `~/.grok\hooks\winsur.json` | Generated Grok hooks |

## Contributing

Issues and pull requests welcome. Winsur is Windows-only by design, so please
test on Windows 10 or 11. Run `npm run lint` and `npx tsc -b` before opening a
PR — both must be clean.

## License

[MIT](LICENSE)
