// Live check: real Claude Code against Winsur's real hook server.
//
//   node test/live/claude-gating.live.cjs [scenario ...]
//
// Not part of `npm test`: it runs `claude -p` (Haiku, a few short calls on
// your account) and needs Claude Code signed in. Your own settings are never
// changed; each run passes a temporary --settings file whose hooks point at a
// throwaway port. Evidence comes from Claude Code itself: whether the command
// actually ran (marker file) and the permission_denials it reports.

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const { createHookServer } = require("../../electron/server.cjs");
const { buildHttpHooks } = require("../../electron/hooks.cjs");

const OUT = path.join(__dirname, "results");
const FIXTURES = path.join(__dirname, "..", "fixtures", "claude-code");

const SCENARIOS = {
  // Control: no Winsur hooks. In -p mode Claude Code cannot prompt, so Bash is refused.
  "control-no-hooks": { mode: "default", hooks: false },
  "allow-default-mode": { mode: "default", decision: "allow" },
  "deny-bypass-mode": { mode: "bypassPermissions", decision: "deny" },
  "winsur-down-default-mode": { mode: "default", proxy: "down" },
  "winsur-down-bypass-mode": { mode: "bypassPermissions", proxy: "down" },
  "crash-while-held-bypass-mode": { mode: "bypassPermissions", proxy: "reset" },
  "hung-past-hook-timeout-bypass-mode": { mode: "bypassPermissions", proxy: "hang", permissionTimeout: 8 },
  // Records what Claude Code really sends when it presents a plan.
  "plan-mode": {
    mode: "plan",
    prompt: "Plan (do not do it) how to add a README.md with one line of text to this empty folder. Present the plan with ExitPlanMode.",
  },
};

const PROMPT =
  "Use the Bash tool exactly once to run this command and use no other tool: " +
  "echo winsur-live > marker.txt\n" +
  "Then reply with one word: DONE if it ran, REFUSED if it was blocked.";

function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Records every hook request, then forwards it to the Winsur server (or misbehaves). */
function startProxy(targetPort, behaviour, record) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      record.push({ path: req.url, body: safeJson(body) });
      if (req.url === "/hooks/permission" && behaviour === "reset") {
        setTimeout(() => req.socket.destroy(), 1500);
        return;
      }
      if (req.url === "/hooks/permission" && behaviour === "hang") return;

      const fwd = http.request(
        {
          host: "127.0.0.1",
          port: targetPort,
          method: req.method,
          path: req.url,
          headers: { ...req.headers, host: `127.0.0.1:${targetPort}` },
        },
        (up) => {
          const out = [];
          up.on("data", (c) => out.push(c));
          up.on("end", () => {
            const text = Buffer.concat(out).toString("utf8");
            const last = record[record.length - 1];
            if (last && last.path === req.url) last.response = safeJson(text);
            res.writeHead(up.statusCode, up.headers);
            res.end(text);
          });
        },
      );
      fwd.on("error", () => res.destroy());
      fwd.end(body);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function runClaude(cwd, settingsFile, mode, prompt = PROMPT) {
  const env = { ...process.env };
  // Run as from a plain terminal: drop anything a parent Claude Code session
  // (or the desktop app) injected, so the CLI uses its own sign-in.
  for (const k of Object.keys(env)) if (/^(CLAUDE|ANTHROPIC_BASE_URL)/.test(k)) delete env[k];
  const args = [
    "-p",
    "--model", "haiku",
    "--settings", settingsFile,
    "--permission-mode", mode,
    "--output-format", "json",
    "--no-session-persistence",
    "--strict-mcp-config",
  ];
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn("claude", args, { cwd, env, shell: process.platform === "win32" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) => resolve({ code, stdout, stderr, seconds: (Date.now() - started) / 1000 }));
    child.stdin.end(prompt);
  });
}

async function runScenario(name) {
  const sc = SCENARIOS[name];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `winsur-live-${name}-`));
  const cwd = path.join(dir, "project");
  fs.mkdirSync(cwd);

  const record = [];
  const cards = [];
  const winsur = createHookServer({});
  const winsurPort = await winsur.start(0);

  let proxy = null;
  let hookPort;
  if (sc.proxy === "down") {
    hookPort = await freePort(); // nothing listens here, as when Winsur is closed
  } else {
    proxy = await startProxy(winsurPort, sc.proxy || "forward", record);
    hookPort = proxy.address().port;
  }

  // Answer the card the way a click would, through the same call the UI makes.
  const responder = setInterval(() => {
    for (const s of winsur.sessionManager.getSessions()) {
      if (s.pending_permission && sc.decision) {
        cards.push({ tool: s.pending_permission.tool_name, input: s.pending_permission.tool_input });
        winsur.sessionManager.respondPermission(s.id, sc.decision);
      }
    }
  }, 100);

  let hooks = {};
  if (sc.hooks !== false) {
    hooks = JSON.parse(JSON.stringify(buildHttpHooks(true)).replaceAll(":18900/", `:${hookPort}/`));
    if (sc.permissionTimeout) hooks.PreToolUse[0].hooks[0].timeout = sc.permissionTimeout;
  }
  const settingsFile = path.join(dir, "settings.json");
  fs.writeFileSync(settingsFile, JSON.stringify({ hooks }, null, 2));

  const run = await runClaude(cwd, settingsFile, sc.mode, sc.prompt);
  clearInterval(responder);
  if (proxy) await new Promise((r) => proxy.close(() => r()));
  await winsur.stop();

  const result = safeJson(run.stdout.trim());
  const ran = fs.existsSync(path.join(cwd, "marker.txt"));
  return {
    scenario: name,
    permissionMode: sc.mode,
    winsur: sc.proxy || (sc.hooks === false ? "no hooks" : "running"),
    answer: sc.decision || null,
    commandRan: ran,
    cardsShown: cards,
    claudeExit: run.code,
    seconds: run.seconds,
    claudeReply: typeof result === "object" ? result.result : null,
    permissionDenials: typeof result === "object" ? result.permission_denials : null,
    hookCalls: record.map((r) => ({ path: r.path, event: r.body?.hook_event_name, tool: r.body?.tool_name, response: r.response })),
    rawPayloads: record,
    stderr: run.stderr.slice(-2000),
  };
}

function sanitize(value) {
  const home = os.homedir();
  return JSON.parse(
    JSON.stringify(value)
      .replaceAll(JSON.stringify(home).slice(1, -1), "C:\\\\Users\\\\user")
      .replaceAll(home.replaceAll("\\", "/"), "C:/Users/user"),
  );
}

(async () => {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENARIOS);
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(FIXTURES, { recursive: true });
  for (const name of names) {
    if (!SCENARIOS[name]) throw new Error(`unknown scenario ${name}`);
    console.log(`== ${name}`);
    const r = await runScenario(name);
    fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(sanitize(r), null, 2));
    for (const [i, p] of r.rawPayloads.entries()) {
      if (p.body && typeof p.body === "object" && p.body.hook_event_name) {
        const file = `${name}--${String(i).padStart(2, "0")}-${p.body.hook_event_name}${p.body.tool_name ? "-" + p.body.tool_name : ""}.json`;
        fs.writeFileSync(path.join(FIXTURES, file), JSON.stringify(sanitize({ path: p.path, body: p.body }), null, 2));
      }
    }
    console.log(
      `   ran=${r.commandRan} reply=${JSON.stringify(r.claudeReply)} denials=${(r.permissionDenials || []).length} ` +
        `cards=${r.cardsShown.length} hookCalls=${r.hookCalls.length} exit=${r.claudeExit} ${r.seconds}s`,
    );
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
