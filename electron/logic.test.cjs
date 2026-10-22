const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { pointInRoundedRect, overlayBounds, centeredIslandRect } = require("./hit-region.cjs");
const {
  SessionManager,
  inferAgentType,
  normalizeHookPayload,
  isNoiseIdleMessage,
} = require("./agent.cjs");
const { buildCursorHooks, stripWinsurHooks } = require("./hooks.cjs");
const {
  classifyProcess,
  planDiscoveries,
  collectArtifacts,
  extractCwd,
  fileUriToPath,
} = require("./discover.cjs");

test("rounded hit target ignores corners and the shadow gutter", () => {
  const rect = { x: 100, y: 40, w: 200, h: 40, r: 20 };
  assert.equal(pointInRoundedRect(200, 60, rect.x, rect.y, rect.w, rect.h, rect.r), true);
  assert.equal(pointInRoundedRect(100, 40, rect.x, rect.y, rect.w, rect.h, rect.r), false);
  assert.equal(pointInRoundedRect(101, 41, rect.x, rect.y, rect.w, rect.h, rect.r), false);
  assert.equal(pointInRoundedRect(120, 60, rect.x, rect.y, rect.w, rect.h, rect.r), true);
  // Just outside the pill, where the old +4px bounding box captured clicks.
  assert.equal(pointInRoundedRect(102, 42, rect.x, rect.y, rect.w, rect.h, 20), false);
  assert.equal(pointInRoundedRect(200, 20, rect.x, rect.y, rect.w, rect.h, rect.r), false);
});

test("overlay bounds keep the island top-center and leave an even gutter", () => {
  const bounds = overlayBounds({ x: 800, y: 8 }, 240, 38, 56);
  assert.deepEqual(bounds, { x: 800 - 120 - 56, y: 8 - 56, width: 240 + 112, height: 38 + 112 });
  const island = centeredIslandRect(bounds, 240, 38, 19);
  assert.equal(island.x + island.w / 2, 800);
  assert.equal(island.y, 8);
  assert.equal(pointInRoundedRect(800, 8 + 19, island.x, island.y, island.w, island.h, island.r), true);
  assert.equal(pointInRoundedRect(bounds.x + 4, bounds.y + 4, island.x, island.y, island.w, island.h, island.r), false);
});

test("inferAgentType does not call Cursor or a claude-named folder Grok", () => {
  assert.equal(
    inferAgentType(
      normalizeHookPayload({
        hook_event_name: "sessionStart",
        conversation_id: "conv-1",
        cursor_version: "1.7.2",
        workspace_roots: ["C:\\work\\app"],
        sessionId: "should-not-matter",
      })
    ),
    "cursor"
  );
  assert.equal(
    inferAgentType({
      cwd: "C:\\work\\claude-utils",
      session_id: "abc",
      hook_event_name: "PreToolUse",
    }),
    "unknown"
  );
  assert.equal(
    inferAgentType({
      transcript_path: "C:\\Users\\me\\.claude\\projects\\foo\\s.jsonl",
      cwd: "C:\\work\\app",
      session_id: "s",
    }),
    "claude-code"
  );
  assert.equal(
    inferAgentType({
      hookEventName: "PreToolUse",
      sessionId: "g1",
      workspaceRoot: "C:\\work\\app",
      toolName: "bash",
    }),
    "grok-build"
  );
  assert.equal(inferAgentType({ agent_type: "codex", sessionId: "x", workspaceRoot: "C:\\work" }), "codex");
  assert.equal(normalizeHookPayload({ workspace_roots: ["D:\\proj"], conversation_id: "c" }).cwd, "D:\\proj");
  assert.equal(normalizeHookPayload({ workspace_roots: ["D:\\proj"], conversation_id: "c" }).session_id, "c");
});

test("long questions are not treated as idle noise", () => {
  assert.equal(isNoiseIdleMessage("idle", "notification"), true);
  assert.equal(isNoiseIdleMessage("finished", ""), true);
  assert.equal(
    isNoiseIdleMessage("I finished the migration — should I delete the old table?", "question"),
    false
  );
});

test("sessions merge by folder, end for real, and do not stick on a finished tool", () => {
  const mgr = new SessionManager();
  const discovered = mgr.noteDiscovered({
    id: "live:claude-code:",
    agent_type: "claude-code",
    cwd: "",
    name: "Claude",
    pid: 42,
    status: "idle",
    last_event_at: new Date().toISOString(),
  });
  assert.equal(discovered.created, true);

  const hooked = mgr.handleEvent({
    hook_event_name: "PreToolUse",
    agent_type: "claude-code",
    session_id: "uuid-1",
    cwd: "C:\\work\\app",
    tool_name: "Bash",
    transcript_path: "C:\\Users\\me\\.claude\\projects\\app\\s.jsonl",
  });
  assert.equal(hooked.id, discovered.session.id);
  assert.equal(hooked.cwd, "C:\\work\\app");
  assert.equal(mgr.getSessions().length, 1);

  const other = mgr.handleEvent({
    hook_event_name: "SessionStart",
    agent_type: "claude-code",
    session_id: "uuid-2",
    cwd: "C:\\work\\other",
    transcript_path: "C:\\Users\\me\\.claude\\projects\\other\\s.jsonl",
  });
  assert.notEqual(other.id, hooked.id);
  assert.equal(mgr.getSessions().length, 2);

  mgr.handleEvent({
    hook_event_name: "PermissionRequest",
    agent_type: "claude-code",
    session_id: "uuid-1",
    cwd: "C:\\work\\app",
    tool_name: "Bash",
    tool_input: { command: "rm -rf ./tmp" },
  });
  assert.ok(mgr.getSessions().find((s) => s.cwd.endsWith("app")).pending_permission);

  mgr.handleEvent({
    hook_event_name: "PostToolUse",
    agent_type: "claude-code",
    session_id: "uuid-1",
    cwd: "C:\\work\\app",
    tool_name: "Bash",
  });
  assert.equal(mgr.getSessions().find((s) => s.cwd.endsWith("app")).pending_permission, null);

  const ended = mgr.handleEvent({
    hook_event_name: "SessionEnd",
    agent_type: "claude-code",
    session_id: "uuid-2",
    cwd: "C:\\work\\other",
  });
  assert.equal(ended.status, "disconnected");
  assert.equal(mgr.getSessions().some((s) => s.cwd.endsWith("other")), false);

  const cursor = mgr.handleEvent({
    hook_event_name: "postToolUse",
    cursor_version: "1.7.2",
    conversation_id: "conv",
    workspace_roots: ["C:\\work\\app"],
    tool_name: "Shell",
    sessionId: "not-grok",
  });
  assert.equal(cursor.agent_type, "cursor");
  assert.equal(cursor.cwd, "C:\\work\\app");
  assert.ok(mgr.getSessions().some((s) => s.agent_type === "cursor"));
  assert.ok(mgr.getSessions().some((s) => s.agent_type === "claude-code"));
});

test("reap removes a discovered agent after its process exits and respects dismiss", () => {
  const mgr = new SessionManager();
  mgr.noteDiscovered({
    id: "live:cursor:c:\\work\\app",
    agent_type: "cursor",
    cwd: "C:\\work\\app",
    name: "app",
    pid: 7,
    status: "idle",
    last_event_at: new Date().toISOString(),
  });
  assert.equal(mgr.getSessions().length, 1);
  const removed = mgr.reap({ livePids: new Set(), liveTypes: new Set() });
  assert.equal(removed.length, 1);
  assert.equal(mgr.getSessions().length, 0);

  mgr.noteDiscovered({
    id: "live:codex:",
    agent_type: "codex",
    cwd: "",
    name: "Codex",
    pid: 9,
    status: "idle",
    last_event_at: new Date().toISOString(),
  });
  const codex = mgr.getSessions()[0];
  mgr.dismiss(codex.id);
  const again = mgr.noteDiscovered({
    id: "live:codex:",
    agent_type: "codex",
    cwd: "",
    name: "Codex",
    pid: 9,
    status: "idle",
    last_event_at: new Date().toISOString(),
  });
  assert.equal(again.skipped, true);
  assert.equal(mgr.getSessions().length, 0);
  mgr.handleEvent({
    hook_event_name: "SessionStart",
    agent_type: "codex",
    session_id: "codex-1",
    cwd: "C:\\work\\codex",
  });
  assert.equal(mgr.getSessions().length, 1);
});

test("failed process scans do not reap live sessions", () => {
  const mgr = new SessionManager();
  mgr.handleEvent({
    hook_event_name: "UserPromptSubmit",
    agent_type: "grok-build",
    session_id: "g",
    cwd: "C:\\work\\g",
    hookEventName: "UserPromptSubmit",
    sessionId: "g",
    workspaceRoot: "C:\\work\\g",
  });
  assert.deepEqual(mgr.reap({ livePids: null, liveTypes: null }), []);
  assert.equal(mgr.getSessions().length, 1);
});

test("cursor hooks use the flat camelCase schema and replace older nested entries", () => {
  const hooks = buildCursorHooks("C:\\tools\\winsur-hook.ps1");
  assert.ok(hooks.sessionStart[0].command.includes("sessionStart cursor"));
  assert.ok(hooks.sessionStart[0].command.startsWith("$input | &"));
  assert.equal(hooks.PreToolUse, undefined);
  assert.equal(hooks.preToolUse, undefined);
  const legacy = [
    { hooks: [{ type: "command", command: "powershell -File winsur-hook.ps1 SessionStart cursor" }] },
    { command: "echo keep-me" },
  ];
  const kept = stripWinsurHooks(legacy);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].command, "echo keep-me");
});

test("process classification and artifact discovery", () => {
  assert.equal(classifyProcess({ name: "Cursor.exe", commandLine: "Cursor.exe", executablePath: "C:\\Program Files\\Cursor\\Cursor.exe" }), "cursor");
  assert.equal(classifyProcess({ name: "Cursor Helper.exe", commandLine: "Cursor.exe --type=gpu", executablePath: "" }), null);
  assert.equal(
    classifyProcess({
      name: "node.exe",
      commandLine: "node C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js",
      executablePath: "C:\\Program Files\\nodejs\\node.exe",
    }),
    "claude-code"
  );
  assert.equal(classifyProcess({ name: "claude.exe", commandLine: "", executablePath: "C:\\Users\\me\\.local\\bin\\claude.exe" }), "claude-code");
  assert.equal(
    classifyProcess({
      name: "Claude.exe",
      commandLine: "",
      executablePath: "C:\\Users\\me\\AppData\\Local\\Programs\\Claude\\Claude.exe",
    }),
    "claude-desktop"
  );
  assert.equal(classifyProcess({ name: "codex.exe", commandLine: "", executablePath: "C:\\Users\\me\\.codex\\codex.exe" }), "codex");
  assert.equal(classifyProcess({ name: "chrome.exe", commandLine: "", executablePath: "" }), null);
  assert.equal(
    inferAgentType({ cwd: "C:\\projects\\grok-experiments", session_id: "x", hook_event_name: "Stop" }),
    "unknown"
  );

  const now = Date.UTC(2026, 9, 22, 12, 0, 0);
  const planned = planDiscoveries({
    now,
    processes: [
      { name: "claude.exe", pid: 10, commandLine: "", executablePath: "C:\\bin\\claude.exe" },
      { name: "Cursor.exe", pid: 11, commandLine: "", executablePath: "C:\\Cursor\\Cursor.exe" },
    ],
    artifacts: [
      { agentType: "claude-code", cwd: "C:\\work\\new", mtime: now - 60 * 1000 },
      { agentType: "claude-code", cwd: "C:\\work\\old", mtime: now - 48 * 60 * 60 * 1000 },
      { agentType: "cursor", cwd: "C:\\work\\editor", mtime: now - 5 * 60 * 1000 },
    ],
  });
  const cwds = planned.sessions.map((s) => `${s.agent_type}:${s.cwd}`).sort();
  assert.deepEqual(cwds, ["claude-code:C:\\work\\new", "cursor:C:\\work\\editor"]);
  assert.equal(planned.sessions.find((s) => s.agent_type === "claude-code").status, "thinking");
  assert.equal(fileUriToPath("file:///c%3A/Users/me/proj"), "c:/Users/me/proj");
  assert.equal(extractCwd('{"cwd":"C:\\\\work\\\\app","x":1}'), "C:\\work\\app");
});

test("collectArtifacts reads claude, codex, and cursor session files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "winsur-discover-"));
  const home = path.join(root, "home");
  const appdata = path.join(root, "appdata");
  fs.mkdirSync(path.join(home, ".claude", "projects", "C--work-app"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".claude", "projects", "C--work-app", "s.jsonl"),
    '{"cwd":"C:\\\\work\\\\app"}\n'
  );
  fs.mkdirSync(path.join(home, ".codex", "sessions", "2026", "10", "22"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".codex", "sessions", "2026", "10", "22", "rollout.jsonl"),
    '{"cwd":"D:\\\\codex\\\\repo"}\n'
  );
  const storage = path.join(appdata, "Cursor", "User", "workspaceStorage", "abc");
  fs.mkdirSync(storage, { recursive: true });
  fs.writeFileSync(path.join(storage, "workspace.json"), JSON.stringify({ folder: "file:///c%3A/work/editor" }));

  const arts = collectArtifacts({ home, appdata });
  const types = arts.map((a) => `${a.agentType}:${a.cwd.replace(/\//g, "\\")}`).sort();
  assert.ok(types.some((t) => t.startsWith("claude-code:C:\\work\\app")));
  assert.ok(types.some((t) => t.startsWith("codex:D:\\codex\\repo")));
  assert.ok(types.some((t) => t.includes("cursor:") && t.toLowerCase().includes("work")));
});
