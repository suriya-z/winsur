# Winsur app test report

Date: 2026-11-21. Commit under test: `8f94f0d` plus the working-tree changes
listed under "Fixed". Machine: Windows 11 Home x64, Node v25.9.0, Electron
37.10.3, Claude Code 2.1.284.

Scope, decided from this PC: Claude Code is the only agent whose commands
Winsur gates (Bash, Write, Edit, NotebookEdit), so testing goes deep there.
Codex CLI, Antigravity, OpenCode, Hermes, Gemini CLI, Copilot and Qwen Code are
installed but report-only; they are not tested in depth.

No test touches real agent settings. The app under Playwright runs with home
and AppData redirected to a temp folder; the live harness passes a temporary
`--settings` file pointing at a throwaway port.

## How to run

| Suite | Command | Needs |
|---|---|---|
| Unit, regression, fault, contract | `npm test` | nothing |
| Real app window (Playwright) | `npm run test:e2e` | port 18900 free; `npx vite build` first |
| Real Claude Code | `node test/live/claude-gating.live.cjs` | `claude auth login` once; a few Haiku calls |

## Results

### 1. Permission gating

| Check | Result | Evidence |
|---|---|---|
| Clicking Allow releases the held command with `allow` | PASS | `test/e2e/app.e2e.cjs`, screenshot `allow-card.png` |
| Clicking Deny answers `deny` | PASS | `test/e2e/app.e2e.cjs` |
| Card shows the exact command being approved | PASS | e2e: card text `npm run build`, `rm -rf build` |
| Agent gives up (socket closed): card withdrawn, no dead Allow | PASS | e2e "when the agent gives up" |
| Two sessions waiting: each Allow answers only its own command | PASS | e2e "two sessions waiting", `two-cards.png` |
| Winsur's 300 s hold ends in `deny`, later requests stay pending | PASS | existing `test/agent.test.cjs` |
| Claude Code itself runs the command after Allow (default mode) | NOT RUN | skipped by decision; standalone `claude` is not signed in |
| Claude Code itself blocks the command after Deny (bypass mode) | NOT RUN | same |
| Claude Code's behaviour with Winsur closed, crashed mid-hold, or hung past the hook timeout | NOT RUN | same; scenarios are written in `test/live/claude-gating.live.cjs` |

### 2. Forgery: can anything other than a click approve?

| Check | Result | Evidence |
|---|---|---|
| A link in an agent's plan lets a web page approve held commands | **FAIL, fixed (BUG-1)** | e2e "a link in an agent's plan…": red before fix (`answered "allow"`), green after |
| No HTTP request can answer a held permission | PASS | `test/faults.test.cjs`: six forged requests, call stays held |
| Browser CORS preflight is not granted | PASS | `test/faults.test.cjs` |
| `text/plain` POST and foreign `Host` header rejected | PASS | existing `test/server.test.cjs` |
| Another program holding port 18900 answers Claude Code's permission requests | **FAIL, open (BUG-2)** | e2e TODO test, `port-busy.png` |

### 3. Real payload contracts

| Check | Result | Evidence |
|---|---|---|
| Recorded Claude Code events land on a Claude Code card | NOT RUN | no recorded payloads (live runs skipped by decision); `test/contract.test.cjs` skips with that reason |
| Recorded gated calls show their command and get a decision in Claude Code's documented shape | NOT RUN | same |
| A Claude Code plan appears as a plan card | NOT RUN, expected FAIL (BUG-3) | marked TODO in `test/contract.test.cjs` |

### 4. Real window (Playwright)

| Check | Result | Evidence |
|---|---|---|
| App launches, shows the island, writes gating hooks only into the fake home | PASS | harness; fake `.claude/settings.json` contains the `/hooks/permission` group |
| Allow / Deny / withdraw / two cards / plan link | PASS | above |
| Overlay passes clicks through to windows behind it | NOT RUN | needs OS-level mouse input; Playwright clicks reach the page directly |

### 5. Regressions (past fixes)

| Fix | Test | Fails before | Passes at fix and now |
|---|---|---|---|
| 6472efa: hooks nested as event → matcher group → handlers | `test/regressions.test.cjs` | yes (at `ad5d453`) | yes |
| 6472efa: gated tools wait on `/hooks/permission`, longer than 300 s | same | yes | yes |
| 6472efa: parallel activity event keeps the card; answering it releases the call | same | yes (call never released) | yes |
| 86e34ff: exact session ids, queued permissions, JSON-only, loopback Host, comment-safe configs, BOM, apostrophe paths | existing tests | not re-proven | yes |

The "stale working" fix exists only on branch `cursor/tauri-port-8202`, not on
`main`, so it has no regression test here.

### 6. Faults

| Check | Result | Evidence |
|---|---|---|
| Malformed JSON: no card, server keeps working | PASS | `test/faults.test.cjs` |
| Malformed body to the blocking endpoint: not held, not `allow` | PASS | same |
| 20 MB event: server stays up | PASS | same |
| Agent config with comments left untouched; missing config created | PASS | existing `test/hooks.test.cjs`; regression tests create it |
| Port 18900 already in use | FAIL (BUG-2) | see below |

## Bugs

**BUG-1 (high, fixed): a plan link turns a web page into an Allow button.**
`PlanReview` renders agent Markdown, so links are clickable. The window had no
navigation guard, and the preload bridge (`window.winsur.invoke`) is exposed to
whatever page loads in it. One click on a link loaded the page inside Winsur,
and that page approved a held `curl … | sh` through `respond_permission`.
Fix in `electron/main.cjs`: `will-navigate` is cancelled and
`setWindowOpenHandler` denies new windows; http(s) links open in the default
browser, where the page has no bridge.

**BUG-2 (medium, open): when another program owns port 18900, Winsur still says
"listening" and leaves its gating hooks pointing there.** The server fails to
start (logged only), the UI shows "Winsur · listening" (hard-coded in
`CollapsedView.tsx`), and `autoInstallOnLaunch` still writes hooks to
`127.0.0.1:18900`. Whatever owns that port then answers every gated Claude Code
request; the test's stand-in answers `allow`. Suggested fix: show the failure
in the UI and skip installing the gating hook when the server did not start.

**BUG-3 (suspected, needs a real payload): Claude Code plans never show.**
`SessionManager.handleEvent` raises a plan card only for events named `Plan`,
`ExitPlanMode`, `ShowPlan` and similar, or for unknown event names. Claude Code
sends a plan as `PreToolUse` with `tool_name: "ExitPlanMode"`, which goes
through the `PreToolUse` branch and never sets `pending_plan`. The live
`plan-mode` scenario records the real payload to confirm.

## Observations (not bugs on their own)

- **Enter approves.** With a card pending and Winsur's window focused, Enter
  allows the first pending request. The window takes keyboard focus at launch.
- **Hooks stay installed after Winsur quits.** `before-quit` stops the server
  but does not remove hooks. Whether that blocks Claude Code or lets commands
  through depends on Claude Code's behaviour with the port closed, which the
  pending live scenarios measure.
- During harness development, a permission sent while the window was still
  loading its page did not appear expanded within 30 s. Not investigated.
