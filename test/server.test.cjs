const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { createHookServer } = require("../electron/server.cjs");

function request(port, { method = "POST", path = "/hooks/event", headers = {}, body = "" }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

const event = JSON.stringify({
  hook_event_name: "SessionStart",
  session_id: "s1",
  cwd: "C:\\work\\app",
  agent_type: "claude-code",
});

async function startServer(t) {
  const server = createHookServer({});
  const port = await server.start(0);
  t.after(() => server.stop());
  return { server, port };
}

test("a JSON POST from a hook client creates a session", async (t) => {
  const { server, port } = await startServer(t);

  const res = await request(port, { headers: { "Content-Type": "application/json" }, body: event });

  assert.equal(res.status, 200);
  assert.equal(server.sessionManager.getSessions().length, 1);
});

test("a text/plain POST (what a cross-site form or no-cors fetch sends) is rejected", async (t) => {
  const { server, port } = await startServer(t);

  const res = await request(port, { headers: { "Content-Type": "text/plain" }, body: event });

  assert.equal(res.status, 415);
  assert.equal(server.sessionManager.getSessions().length, 0);
});

test("a request with a foreign Host header (DNS rebinding) is rejected", async (t) => {
  const { port } = await startServer(t);

  const res = await request(port, { method: "GET", path: "/sessions", headers: { Host: `evil.example:${port}` } });

  assert.equal(res.status, 403);
});

test("an aborted permission request clears the card", async (t) => {
  const { server, port } = await startServer(t);
  const body = JSON.stringify({
    hook_event_name: "PreToolUse",
    session_id: "s1",
    cwd: "C:\\work\\app",
    agent_type: "claude-code",
    tool_name: "Bash",
    tool_input: { command: "npm test" },
  });

  const req = http.request({
    host: "127.0.0.1",
    port,
    method: "POST",
    path: "/hooks/permission",
    headers: { "Content-Type": "application/json" },
  });
  req.on("error", () => {});
  req.end(body);

  await waitFor(() => server.sessionManager.getSessions()[0]?.pending_permission);
  req.destroy();
  await waitFor(() => server.sessionManager.getSessions()[0]?.pending_permission === null);

  assert.equal(server.sessionManager.getSessions()[0].pending_permission, null);
});

async function waitFor(check, timeoutMs = 2000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}
