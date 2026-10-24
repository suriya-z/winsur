# Tauri 2 parity checklist

Winsur's Electron main process (`electron/`) is reimplemented in Rust. The React UI in `src/` is unchanged aside from the bridge. Every item below is a behavior the Electron app had, including the click-through, discovery, and single-instance fixes.

Nothing in this file may be left unchecked. CI fails if a line still starts with an empty checkbox.

## Startup, single instance, tray

- [x] App display name is Winsur and the single-instance lock is not the generic Electron id. Lock id is the bundle identifier `com.winsur.app` (`src-tauri/tauri.conf.json`), and `tauri-plugin-single-instance` is registered first (`src-tauri/src/lib.rs`).
- [x] A second launch does not bind a second hook server. It exits on its own and asks the running instance to show, restore, raise, and focus the island (`src-tauri/src/lib.rs`).
- [x] Closing the island hides it and leaves the process (and the tray) running. Quit happens only from the tray Quit item (`src-tauri/src/lib.rs`).
- [x] Windows AppUserModelID is `com.winsur.app` so notifications and the taskbar identity match the old `setAppUserModelId` (`src-tauri/src/win32.rs`).
- [x] Startup order: bind the hook server (UI still comes up if port 18900 is busy), clear in-memory sessions, show the island, create the tray, auto-install hooks, then discover already-running agents and repeat every 20s. Hook install does not gate the first show (`src-tauri/src/lib.rs`).
- [x] On exit, discovery stops, SSH tunnels are killed, and the hook server closes (`src-tauri/src/lib.rs`).
- [x] Tray icon, tooltip "Winsur", Show/Hide, and Quit. A left click or Show/Hide brings the island back on screen and focuses it when it was hidden or off the work area (`src-tauri/src/lib.rs`). Packaged builds have no console window (`windows_subsystem`).
- [x] Release builds append startup, panics, and window geometry to `%APPDATA%\Winsur\winsur.log` (`src-tauri/src/logfile.rs`).

## Overlay and click-through

- [x] Frameless transparent always-on-top window, no shadow, not resizable, file drop disabled, shown without stealing focus. The window is created visible so WebView2 composites; a later hide/show toggles the controller or the surface stays blank (`src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs`, `src-tauri/src/win32.rs`).
- [x] `WS_THICKFRAME` is cleared so the invisible resize border is not a dead zone (`src-tauri/src/win32.rs`).
- [x] Window is sized to the visible island plus a 56px shadow gutter. Default island is 240×38, radius 19. Anchor is the primary work-area top center, 8px down (`crates/winsur-core/src/hit_region.rs`, `src-tauri/src/overlay.rs`).
- [x] Hit testing uses the rounded rect, not the bounding box. Shadow gutter and corner pixels pass through (`crates/winsur-core/src/hit_region.rs`).
- [x] The main process polls the cursor every 16ms and calls `set_ignore_cursor_events`. This does not depend on a mouse-move forward hook. Ignore is reapplied after every move/resize. During a drag the window captures the pointer (`src-tauri/src/overlay.rs`).
- [x] The renderer reports `getBoundingClientRect` plus the computed radius, and the hit target tracks that box through the expand/collapse animation (`src/components/Island/IslandContainer.tsx`, `report_island_metrics`).
- [x] Drag starts after 5px, polls every 8ms, and has a 15s safety stop. Anchor is the island's top center (`src/lib/bridge.ts`, `src-tauri/src/overlay.rs`).
- [x] `set_ignore_mouse_events` from the UI is accepted and ignored, so it cannot fight the poll (`src-tauri/src/commands.rs`).
- [x] Jump/reply/plan hide the island (not topmost, click-through, hidden) for 220ms before Win32 focus, then restore. A successful jump does not focus Winsur; a failed jump does (`src-tauri/src/commands.rs`).

## Hook server

- [x] Listens on `127.0.0.1:18900` only. No CORS headers (`crates/winsur-core/src/server.rs`).
- [x] `GET /health`, `GET /debug/events` (last 50 lines), `GET /agents` `/hooks/sessions` `/sessions` (`crates/winsur-core/src/server.rs`).
- [x] `POST /hooks/event` normalizes the payload, updates the session, emits `agent-update` and `agents-sync`, returns `{}`. Bad JSON returns `{}` (`crates/winsur-core/src/server.rs`).
- [x] `POST /hooks/permission` is forced to `PermissionRequest`, waits up to 300s, and answers with Claude's `hookSpecificOutput` allow/deny body (`crates/winsur-core/src/server.rs`).
- [x] Toasts: permission, done (Stop/StopFailure), and question only when the session is actually waiting on a question (`crates/winsur-core/src/server.rs`, `src-tauri/src/lib.rs`).

## Session manager

- [x] One card per agent type + normalized cwd + remote. Empty-cwd placeholders absorb the first event that names a folder. A second folder stays its own card (`crates/winsur-core/src/agent.rs`).
- [x] `inferAgentType` order: explicit `agent_type`, Cursor fields, Antigravity, Hermes, transcript install markers (not a substring in the project path), Grok camelCase signature, Claude `permission_mode`, then model. Nothing defaults to Grok just because `sessionId` is set (`crates/winsur-core/src/agent.rs`).
- [x] Event aliases cover Claude, Codex, Cursor (including `workspaceOpen`, `afterAgentResponse`, shell/MCP), and Hermes (`crates/winsur-core/src/agent.rs`).
- [x] Idle noise is only the stock short status lines. A long question that mentions "finished" stays a question (`crates/winsur-core/src/agent.rs`).
- [x] `PostToolUse` clears a permission for that tool (or a generic "Permission" card) and does not clear a card for a different tool (`crates/winsur-core/src/agent.rs`).
- [x] `SessionEnd` returns the session as disconnected and deletes it so the UI cannot merge it back (`crates/winsur-core/src/agent.rs`).
- [x] Dismiss and Clear stay dismissed until a real hook event for that card. `clearAll` on startup does not wipe the dismissed set (`crates/winsur-core/src/agent.rs`).
- [x] Auto-idle after 6s of quiet "thinking", cancelled while a tool, permission, question, or plan is active (`crates/winsur-core/src/agent.rs`).
- [x] Permission waiters: a new wait denies the previous one; timeout denies; removing a session denies (`crates/winsur-core/src/agent.rs`).
- [x] Reply updates the real session (status thinking, last tool "reply sent"). The Electron handler mutated the public copy, so that status never stuck (`src-tauri/src/commands.rs`).

## Discovery

- [x] Process classification skips helpers (`--type=`, crashpad, helper, gpu, utility). `Cursor.exe` is Cursor; `claude.exe` under `Programs\Claude` or `AnthropicClaude` is the desktop app; otherwise it is Claude Code. `node.exe` only counts when the command line is Claude Code, Codex, Gemini CLI, or Qwen (`crates/winsur-core/src/discover.rs`).
- [x] Process list and command lines come from Toolhelp + the PEB, not PowerShell. A failed snapshot returns null and does not reap (`src-tauri/src/win32.rs`, `crates/winsur-core/src/discover.rs`).
- [x] Session files: Claude `~/.claude/projects`, Codex `~/.codex/sessions` (depth 4), Grok `~/.grok` (depth 3), Gemini, Hermes, Cursor and Windsurf `workspaceStorage` (`crates/winsur-core/src/discover.rs`).
- [x] Only types with a live process are shown. Artifacts touched within 12h (otherwise the single newest), cap 4 per type. mtime under 2 minutes is "thinking", else "idle" (`crates/winsur-core/src/discover.rs`).
- [x] Reap removes a card whose type is gone, immediately for discovered-only cards, after 60s if it is waiting and the pid is dead, and after 3 minutes for a quiet hooked session. A null scan removes nothing (`crates/winsur-core/src/agent.rs`).

## Hook installer

- [x] Every registry agent is detected by config path, known directory, or PATH (including `%APPDATA%\npm`), and existing user hooks are kept (`crates/winsur-core/src/registry.rs`, `crates/winsur-core/src/hooks.rs`).
- [x] Hook scripts are bundled resources, with a dev fallback to `hooks/` (`src-tauri/tauri.conf.json`, `crates/winsur-core/src/hooks.rs`).
- [x] Claude Code gets HTTP hooks plus a gated `PreToolUse` for `Bash|Write|Edit|NotebookEdit` (310s timeout) at the permission URL. Other settings-style hosts get command hooks and are not gated (`crates/winsur-core/src/hooks.rs`).
- [x] Grok is HTTP-only `~/.grok/hooks/winsur.json`. The legacy `vibe-island.json` file is removed (`crates/winsur-core/src/hooks.rs`).
- [x] Cursor uses the flat camelCase schema and `$input | & 'script'`. Permission hooks are not installed. Older nested Winsur entries are stripped; user commands stay (`crates/winsur-core/src/hooks.rs`).
- [x] Codex uses nested command hooks with `command` and `commandWindows` (`crates/winsur-core/src/hooks.rs`).
- [x] Antigravity, OpenCode, and Hermes installers and uninstallers match the Electron output, including the Hermes `config.yaml` plugin list (`crates/winsur-core/src/hooks.rs`).
- [x] `winsur-hook.ps1` is unchanged: `$input` first, System32 cwd dropped, Cursor `{"continue":true}`, Codex `{}` (`hooks/winsur-hook.ps1`).

## Jump, reply, plan

- [x] Window search uses `EnumWindows` (not `MainWindowHandle`), the same title/process filters, and the same score (terminal host, agent name, folder needle, parent-process tree) (`crates/winsur-core/src/focus.rs`, `src-tauri/src/win32.rs`).
- [x] Foreground is taken with the Alt-key trick, `AttachThreadInput`, and `SetForegroundWindow`, then checked. Failure details still contain `AGENT_EXITED`, `NO_WINDOW`, or `NO_FOCUS`, and the same notification text is shown (`src-tauri/src/win32.rs`, `src-tauri/src/commands.rs`).
- [x] Terminal reply and plan approve/feedback copy Unicode text to the clipboard and send Ctrl+V, Enter. Success requires the target to still be foreground. Plan clear and question clear run only after a successful send (`src-tauri/src/win32.rs`, `src-tauri/src/commands.rs`).

## Settings, usage, SSH, sounds

- [x] Settings live in `~/.winsur/settings.json` with the same defaults (`httpPort` 18900, sound on, volume 80, `autoStart` false, theme dark). Saves merge (`crates/winsur-core/src/settings.rs`).
- [x] Usage rows read the same local Claude, Codex, Kimi, DeepSeek, GLM, and Grok files (`crates/winsur-core/src/usage.rs`).
- [x] SSH remotes persist in `~/.winsur/ssh-remotes.json`. Connect opens `ssh -N -R <port>:127.0.0.1:18900` with the same keepalive options. Disconnect, remove, list, and the remote deploy script match (`crates/winsur-core/src/ssh.rs`).
- [x] Sounds stay in the renderer (Web Audio). Settings still drive enabled and volume (`src/lib/sounds.ts`, `src/hooks/useAgentEvents.ts`).

## UI bridge

- [x] `src/lib/bridge.ts` keeps the same exported functions. They call Tauri commands and events (`get_agents`, `agent-update`, `agents-sync`, `agents-cleared`, drag, metrics) instead of Electron preload (`src/lib/bridge.ts`, `src-tauri/src/commands.rs`).
- [x] `window.winsur` and `window.vibeIsland` are still installed for callers that touch the global (`src/lib/bridge.ts`).
- [x] Island width, keyboard shortcuts, agent icons, and the stores are unchanged (`src/components/`, `src/hooks/useKeyboardShortcuts.ts`, `src/stores/agentStore.ts`).

## Packaging

- [x] Electron, electron-builder, and `electron/` are removed. `npm start` is `tauri dev`. `npm run dist` is `tauri build` (`package.json`).
- [x] Windows x64 NSIS and MSI bundles, WebView2 download bootstrapper (`src-tauri/tauri.conf.json`).
- [x] `npm run lint`, `npx tsc -b`, `cargo clippy`, `cargo test`, and a full Tauri build run on `windows-latest` (`.github/workflows/windows.yml`).
- [x] `electron/logic.test.cjs` coverage lives in the `winsur-core` unit tests.
