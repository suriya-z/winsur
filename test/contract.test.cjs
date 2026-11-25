// Contract tests: replay hook payloads recorded from real Claude Code
// (test/live/claude-gating.live.cjs writes them to test/fixtures/claude-code)
// against Winsur's hook server, and check Winsur understands each one.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { createHookServer } = require("../electron/server.cjs");

const DIR = path.join(__dirname, "fixtures", "claude-code");
const fixtures = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) }))
  : [];
const NO_FIXTURES = fixtures.length ? false : "no recorded Claude Code payloads yet: run node test/live/claude-gating.live.cjs";

function send(port, pathname, body, signal) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method: "POST", path: pathname, headers: { "Content-Type": "application/json" }, signal },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString() || "null") }));
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

async function startServer(t) {
  const server = createHookServer({});
  const port = await server.start(0);
  const hold = new AbortController();
  t.after(() => {
    hold.abort();
    return server.stop();
  });
  return { server, port, signal: hold.signal };
}

test("every recorded Claude Code event is accepted and lands on a Claude Code card", { skip: NO_FIXTURES }, async (t) => {
  for (const fx of fixtures.filter((f) => f.path === "/hooks/event")) {
    await t.test(fx.file, async (t) => {
      const { server, port } = await startServer(t);
      const res = await send(port, "/hooks/event", fx.body);
      assert.equal(res.status, 200);
      const sessions = server.sessionManager.getSessions();
      if (fx.body.hook_event_name === "SessionEnd") return; // ends the card by design
      assert.equal(sessions.length, 1, `no card for ${fx.body.hook_event_name}`);
      assert.equal(sessions[0].agent_type, "claude-code");
    });
  }
});

test("every recorded gated tool call shows its command on the card and gets a decision Claude Code accepts", { skip: NO_FIXTURES }, async (t) => {
  for (const fx of fixtures.filter((f) => f.path === "/hooks/permission")) {
    await t.test(fx.file, async (t) => {
      const { server, port, signal } = await startServer(t);
      const held = send(port, "/hooks/permission", fx.body, signal);
      let card;
      for (let i = 0; i < 50 && !card; i++) {
        await new Promise((r) => setTimeout(r, 20));
        card = server.sessionManager.getSessions().find((s) => s.pending_permission);
      }
      assert.ok(card, "no permission card raised");
      assert.equal(card.pending_permission.tool_name, fx.body.tool_name);
      assert.deepEqual(card.pending_permission.tool_input, fx.body.tool_input);

      server.sessionManager.respondPermission(card.id, "deny");
      const { body } = await held;
      // Shape Claude Code documents for a PreToolUse decision.
      assert.deepEqual(Object.keys(body), ["hookSpecificOutput"]);
      assert.equal(body.hookSpecificOutput.hookEventName, "PreToolUse");
      assert.equal(body.hookSpecificOutput.permissionDecision, "deny");
    });
  }
});

const planFixtures = fixtures.filter((f) => f.body?.tool_name === "ExitPlanMode");
test("a recorded Claude Code plan appears as a plan card", {
  skip: planFixtures.length ? false : "no recorded ExitPlanMode payload yet: run the plan-mode live scenario",
  todo: "BUG-3 (test/REPORT.md): Claude Code sends plans as PreToolUse/ExitPlanMode, which never sets pending_plan",
}, async (t) => {
  const { server, port } = await startServer(t);
  await send(port, "/hooks/event", planFixtures[0].body);
  assert.ok(server.sessionManager.getSessions()[0]?.pending_plan, "plan was not shown");
});
