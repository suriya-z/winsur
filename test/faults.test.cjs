// Fault tests at the hook server's HTTP seam.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { createHookServer } = require("../electron/server.cjs");

function send(port, { method = "POST", path = "/hooks/event", body = "", headers = { "Content-Type": "application/json" }, signal }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers, signal }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function startServer(t) {
  const server = createHookServer({});
  const port = await server.start(0);
  const hold = new AbortController();
  // Drop held calls before stopping, or the server waits out the 300s hold.
  t.after(() => {
    hold.abort();
    return server.stop();
  });
  return { server, port, signal: hold.signal };
}

const event = (sid, extra = {}) =>
  JSON.stringify({ hook_event_name: "SessionStart", session_id: sid, cwd: `C:\\work\\${sid}`, agent_type: "claude-code", ...extra });

test("malformed JSON is answered without a card, and the server keeps working", async (t) => {
  const { server, port } = await startServer(t);

  const bad = await send(port, { body: '{"hook_event_name": "SessionStart", ' });
  const good = await send(port, { body: event("after-bad") });

  assert.equal(bad.status, 200);
  assert.equal(good.status, 200);
  assert.deepEqual(server.sessionManager.getSessions().map((s) => s.id), ["after-bad"]);
});

test("a malformed request to the blocking endpoint is not held and not answered allow", async (t) => {
  const { port } = await startServer(t);

  const res = await send(port, { path: "/hooks/permission", body: "{not json" });

  assert.equal(res.status, 200);
  assert.doesNotMatch(res.body, /"allow"/);
});

test("a 20 MB event (a huge tool output) does not take the server down", async (t) => {
  const { server, port } = await startServer(t);
  const huge = event("huge", { hook_event_name: "PostToolUse", tool_name: "Bash", tool_response: { stdout: "x".repeat(20 * 1024 * 1024) } });

  await send(port, { body: event("huge") }); // Claude Code opens every session with SessionStart
  const res = await send(port, { body: huge });
  const next = await send(port, { body: event("next") });

  assert.equal(res.status, 200);
  assert.equal(next.status, 200);
  assert.equal(server.sessionManager.getSessions().length, 2);
});

test("a browser's CORS preflight is not granted, so a page cannot send JSON to the hook server", async (t) => {
  const { port } = await startServer(t);

  const res = await send(port, {
    method: "OPTIONS",
    path: "/hooks/permission",
    headers: {
      Origin: "https://evil.example",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });

  assert.equal(res.headers["access-control-allow-origin"], undefined);
});

test("no HTTP request can answer a held permission: only the in-app Allow can", async (t) => {
  const { server, port, signal } = await startServer(t);
  const call = { hook_event_name: "PreToolUse", session_id: "s1", cwd: "C:\\work\\app", agent_type: "claude-code", tool_name: "Bash", tool_input: { command: "rm -rf /" } };
  let answered = null;
  http
    .request({ host: "127.0.0.1", port, method: "POST", path: "/hooks/permission", headers: { "Content-Type": "application/json" }, signal }, (res) => {
      res.resume();
      answered = res.statusCode;
    })
    .on("error", () => {})
    .end(JSON.stringify(call));
  await new Promise((r) => setTimeout(r, 150));

  // Everything a local process could try that looks like an answer.
  const forged = [
    { path: "/hooks/event", body: JSON.stringify({ ...call, hook_event_name: "PostToolUse" }) },
    { path: "/hooks/event", body: JSON.stringify({ ...call, hook_event_name: "PermissionRequest", decision: "allow" }) },
    { path: "/hooks/event", body: JSON.stringify({ ...call, hook_event_name: "Notification", notification_type: "permission_granted" }) },
    { path: "/hooks/permission", body: JSON.stringify({ ...call, permissionDecision: "allow" }) },
    { path: "/respond_permission", body: JSON.stringify({ sessionId: "s1", decision: "allow" }) },
    { path: "/hooks/respond", body: JSON.stringify({ sessionId: "s1", decision: "allow" }) },
  ];
  for (const f of forged) {
    await Promise.race([send(port, { ...f, signal }).catch(() => {}), new Promise((r) => setTimeout(r, 200))]);
  }
  await new Promise((r) => setTimeout(r, 200));

  assert.equal(answered, null, "the held call was answered by a forged request");
  assert.ok(server.sessionManager.getSessions().find((s) => s.id === "s1")?.pending_permission, "card disappeared");
});
