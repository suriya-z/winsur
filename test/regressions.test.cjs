// Regression tests for past fixes. Each is written against a seam that also
// existed before its fix, so it can be shown to fail on the commit before:
//   commit 6472efa "fix: make permission gating actually gate"

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { execFileSync } = require("child_process");
const { createHookServer } = require("../electron/server.cjs");

/** Run Winsur's hook installer with home pointed at a temp folder; return Claude Code's settings. */
function claudeSettingsAfterInstall() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "winsur-reg-home-"));
  fs.mkdirSync(path.join(home, ".claude"));
  const env = { ...process.env, USERPROFILE: home, HOME: home, APPDATA: path.join(home, "r"), LOCALAPPDATA: path.join(home, "l") };
  execFileSync(process.execPath, ["-e", "require('./electron/hooks.cjs').installAllHooks()"], {
    cwd: path.join(__dirname, ".."),
    env,
    stdio: "ignore",
  });
  return JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
}

test("6472efa: Claude Code hooks are written as event -> matcher group -> handlers", () => {
  const { hooks } = claudeSettingsAfterInstall();

  for (const [event, groups] of Object.entries(hooks)) {
    for (const group of groups) {
      assert.ok(Array.isArray(group.hooks), `${event} entry is a bare handler, not a matcher group: ${JSON.stringify(group)}`);
    }
  }
});

test("6472efa: Bash, Write, Edit and NotebookEdit wait on the blocking endpoint longer than Winsur holds them", () => {
  const { hooks } = claudeSettingsAfterInstall();

  const gated = (hooks.PreToolUse || []).find((g) => g.matcher === "Bash|Write|Edit|NotebookEdit");
  assert.ok(gated, "no PreToolUse group gates Bash|Write|Edit|NotebookEdit");
  const handler = gated.hooks[0];
  assert.match(handler.url, /\/hooks\/permission$/);
  assert.ok(handler.timeout > 300, `agent gives up after ${handler.timeout}s, before Winsur's 300s answer window`);
});

function request(port, pathname, body, signal) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method: body ? "POST" : "GET", path: pathname, headers: { "Content-Type": "application/json" }, signal },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString() || "null")));
      },
    );
    req.on("error", reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

test("6472efa: the parallel activity event does not wipe the card, and answering the card releases the tool call", async (t) => {
  const server = createHookServer({});
  const port = await server.start(0);
  const hold = new AbortController();
  // Drop the held call before stopping, or a never-answered call keeps the server open.
  t.after(() => {
    hold.abort();
    return server.stop();
  });
  const call = {
    hook_event_name: "PreToolUse",
    session_id: "claude-session-1",
    cwd: "C:\\work\\app",
    agent_type: "claude-code",
    tool_name: "Bash",
    tool_input: { command: "npm publish" },
  };

  // Claude Code fires both hook groups for the same tool call, in parallel.
  const held = request(port, "/hooks/permission", call, hold.signal).catch(() => "aborted");
  await new Promise((r) => setTimeout(r, 150));
  await request(port, "/hooks/event", call);

  const [card] = (await request(port, "/sessions")).filter((s) => s.pending_permission);
  assert.ok(card, "the permission card was wiped by the activity event");
  assert.equal(card.pending_permission.tool_name, "Bash");

  server.sessionManager.respondPermission(card.id, "allow"); // what the Allow button calls
  const answer = await Promise.race([held, new Promise((r) => setTimeout(() => r("still-held"), 2000))]);
  assert.equal(answer?.hookSpecificOutput?.permissionDecision, "allow", `held call got ${JSON.stringify(answer)}`);
});
