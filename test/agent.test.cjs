const test = require("node:test");
const assert = require("node:assert/strict");
const { SessionManager } = require("../electron/agent.cjs");

function permissionPayload(command, extra = {}) {
  return {
    hook_event_name: "PreToolUse",
    session_id: "claude-1",
    cwd: "C:\\work\\app",
    agent_type: "claude-code",
    tool_name: "Bash",
    tool_input: { command },
    ...extra,
  };
}

test("findSession returns null for an unknown id instead of another agent", () => {
  const sm = new SessionManager();
  sm.handleEvent({ hook_event_name: "SessionStart", session_id: "g1", cwd: "C:\\a", agent_type: "grok-build" });
  sm.handleEvent({ hook_event_name: "SessionStart", session_id: "c1", cwd: "C:\\b", agent_type: "claude-code" });

  assert.equal(sm.findSession("no-such-id"), null);
});

test("findSession returns the session with the exact id", () => {
  const sm = new SessionManager();
  sm.handleEvent({ hook_event_name: "SessionStart", session_id: "c1", cwd: "C:\\b", agent_type: "claude-code" });

  assert.equal(sm.findSession("c1").id, "c1");
});

test("a second held permission on the same card does not deny the first", async () => {
  const sm = new SessionManager();
  const first = sm.holdPermission(permissionPayload("npm test"), 60000);
  const second = sm.holdPermission(permissionPayload("npm run build"), 60000);

  sm.respondPermission(first.session.id, "allow");
  sm.respondPermission(first.session.id, "allow");

  assert.equal(await first.decision, "allow");
  assert.equal(await second.decision, "allow");
});

test("the card shows the oldest held request, then the next one after it is answered", () => {
  const sm = new SessionManager();
  const first = sm.holdPermission(permissionPayload("npm test"), 60000);
  sm.holdPermission(permissionPayload("npm run build"), 60000);
  const id = first.session.id;

  assert.equal(sm.findSession(id).pending_permission.description, "npm test");
  sm.respondPermission(id, "deny");
  assert.equal(sm.findSession(id).pending_permission.description, "npm run build");
  assert.equal(sm.findSession(id).status, "waiting");
});

test("cancelling a held request clears the card and does not resolve allow", async () => {
  const sm = new SessionManager();
  const controller = new AbortController();
  const held = sm.holdPermission(permissionPayload("rm -rf dist"), 60000, controller.signal);

  controller.abort();

  assert.equal(await held.decision, "cancel");
  const s = sm.findSession(held.session.id);
  assert.equal(s.pending_permission, null);
  assert.notEqual(s.status, "waiting");
});

test("a held request that times out is denied and leaves later requests pending", async () => {
  const sm = new SessionManager();
  const first = sm.holdPermission(permissionPayload("npm test"), 10);
  const second = sm.holdPermission(permissionPayload("npm run build"), 60000);

  assert.equal(await first.decision, "deny");
  assert.equal(sm.findSession(first.session.id).pending_permission.description, "npm run build");
  sm.respondPermission(first.session.id, "allow");
  assert.equal(await second.decision, "allow");
});
