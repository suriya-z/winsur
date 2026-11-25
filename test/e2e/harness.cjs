// Launch the real Winsur Electron app for end-to-end tests, isolated from the
// user's machine: home and AppData point at a temp folder, so the hook
// installer that runs on launch writes only into fake agent configs there.

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { _electron } = require("playwright");

const ROOT = path.join(__dirname, "..", "..");
const PORT = 18900;
const ARTIFACTS = path.join(__dirname, "artifacts");

function fakeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "winsur-e2e-home-"));
  for (const d of ["AppData/Roaming", "AppData/Local", ".claude"]) fs.mkdirSync(path.join(home, d), { recursive: true });
  return home;
}

async function launchApp(t, { waitServer = true } = {}) {
  const home = fakeHome();
  const env = {
    ...process.env,
    USERPROFILE: home,
    HOME: home,
    APPDATA: path.join(home, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(home, "AppData", "Local"),
    VITE_DEV_SERVER_URL: "http://127.0.0.1:9/", // closed port: load dist/ immediately
  };
  for (const k of Object.keys(env)) if (/^(CLAUDE|ANTHROPIC)/.test(k)) delete env[k];

  const app = await _electron.launch({ args: ["."], cwd: ROOT, env, timeout: 30000 });
  const logs = [];
  app.process().stdout?.on("data", (c) => logs.push(String(c)));
  app.process().stderr?.on("data", (c) => logs.push(String(c)));
  t.after(async () => {
    await app.close().catch(() => {});
  });

  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await win.getByText(/Winsur ·/).waitFor({ timeout: 20000 }); // renderer is up and subscribed
  if (waitServer) await waitForServer();
  return { app, win, home, logs };
}

function post(pathname, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: PORT, method: "POST", path: pathname, headers: { "Content-Type": "application/json" } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          let json = text;
          try {
            json = JSON.parse(text);
          } catch {
            /* keep text */
          }
          resolve({ status: res.statusCode, body: json });
        });
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

/** Send a gated tool call the way Claude Code does; resolves with Winsur's decision. */
function holdPermission(body) {
  let req;
  const decision = new Promise((resolve, reject) => {
    req = http.request(
      { host: "127.0.0.1", port: PORT, method: "POST", path: "/hooks/permission", headers: { "Content-Type": "application/json" } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()).hookSpecificOutput?.permissionDecision ?? null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", (e) => (e.code === "ECONNRESET" ? resolve("connection-reset") : reject(e)));
    req.end(JSON.stringify(body));
  });
  return { decision, abort: () => req.destroy() };
}

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    const ok = await new Promise((resolve) => {
      http
        .get({ host: "127.0.0.1", port: PORT, path: "/health" }, (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        })
        .on("error", () => resolve(false));
    });
    if (ok) return;
    if (Date.now() - start > timeoutMs) throw new Error("hook server never came up on 18900");
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function shot(win, name) {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  await win.screenshot({ path: path.join(ARTIFACTS, `${name}.png`) });
}

function bashCall(sessionId, command, extra = {}) {
  return {
    hook_event_name: "PreToolUse",
    session_id: sessionId,
    cwd: `C:\\work\\${sessionId}`,
    agent_type: "claude-code",
    tool_name: "Bash",
    tool_input: { command },
    ...extra,
  };
}

module.exports = { launchApp, post, holdPermission, shot, bashCall, PORT, ROOT, ARTIFACTS };
