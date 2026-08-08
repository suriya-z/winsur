// Zero-config hook installer — all agents from agents-registry.cjs

const fs = require("fs");
const path = require("path");
const { getAgentRegistry } = require("./agents-registry.cjs");

const HOOK_URL = "http://127.0.0.1:18900/hooks/event";
const PERMISSION_URL = "http://127.0.0.1:18900/hooks/permission";

/**
 * Tools held for explicit Allow/Deny in Winsur. Exact-match list (letters +
 * "|" only), so "Edit" will not silently also catch "NotebookEdit".
 */
const GATED_TOOLS = "Bash|Write|Edit|NotebookEdit";

/** Must outlast SessionManager.waitPermission (300s) or the agent gives up first. */
const PERMISSION_TIMEOUT_SEC = 310;
const EVENT_TIMEOUT_SEC = 5;

const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "Stop",
  "SessionStart",
  "SessionEnd",
];

function getAgentHosts() {
  return getAgentRegistry().map((a) => ({
    name: a.name,
    key: a.key,
    configPath: a.configPath,
    hooksKey: a.hooksKey || "hooks",
    kind: a.kind || "settings",
    typeId: a.typeId,
    detectDirs: a.detectDirs || [],
  }));
}

function getHooksDir() {
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, "hooks"));
  const dev = path.join(__dirname, "..", "hooks");
  candidates.push(dev, path.join(process.cwd(), "hooks"));
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "winsur-hook.ps1"))) return dir;
  }
  return dev;
}

function getHookScriptPath() {
  const p = path.join(getHooksDir(), "winsur-hook.ps1");
  return fs.existsSync(p) ? p : null;
}

function isDetected(host) {
  if (host.configPath && fs.existsSync(host.configPath)) return true;
  if (host.configPath) {
    const parent = path.dirname(host.configPath);
    if (fs.existsSync(parent)) return true;
  }
  for (const d of host.detectDirs || []) {
    if (d && fs.existsSync(d)) return true;
  }
  return false;
}

function hookCommand(scriptPath, eventName) {
  return `powershell -ExecutionPolicy Bypass -NoProfile -File "${scriptPath}" ${eventName}`;
}

/**
 * Hook config nests event -> matcher group -> handlers. Writing handlers
 * straight into the event array (as builds before this did) parses as an
 * invalid matcher group and the hooks never fire.
 *
 * @param {boolean} gate  Hold GATED_TOOLS at the blocking permission endpoint.
 */
function buildHttpHooks(gate) {
  const relay = { type: "http", url: HOOK_URL, timeout: EVENT_TIMEOUT_SEC };
  const hooks = {};
  for (const e of HOOK_EVENTS) {
    hooks[e] = [{ hooks: [{ ...relay }] }];
  }
  if (gate) {
    // Runs alongside the relay group; the relay reports activity, this one decides.
    hooks.PreToolUse.unshift({
      matcher: GATED_TOOLS,
      hooks: [{ type: "http", url: PERMISSION_URL, timeout: PERMISSION_TIMEOUT_SEC }],
    });
  }
  return hooks;
}

function buildCommandHooks(scriptPath) {
  const hooks = {};
  for (const e of HOOK_EVENTS) {
    hooks[e] = [{ hooks: [{ type: "command", command: hookCommand(scriptPath, e) }] }];
  }
  return hooks;
}

/** True for a handler this app installed (any generation of it). */
function isWinsurHandler(handler) {
  const cmd = String(handler?.command || "");
  const url = String(handler?.url || "");
  return (
    cmd.includes("vibe-island") ||
    cmd.includes("winsur-hook") ||
    url.includes("18900")
  );
}

/**
 * Remove previously installed Winsur handlers, leaving the user's own hooks
 * untouched. Handles both the current nested shape and the flat handlers
 * older builds wrote — without this, autoInstallOnLaunch duplicates hooks
 * on every start.
 */
function stripWinsurHooks(groups) {
  if (!Array.isArray(groups)) return [];
  const out = [];
  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    if (!Array.isArray(group.hooks)) {
      // Flat handler written directly into the event array by an older build.
      if (!isWinsurHandler(group)) out.push(group);
      continue;
    }
    const kept = group.hooks.filter((h) => !isWinsurHandler(h));
    if (kept.length) out.push({ ...group, hooks: kept });
  }
  return out;
}

/** Grok: HTTP only — dual HTTP+command double-fires and creates 2 cards */
function buildGrokHookFile() {
  const relay = () => ({
    hooks: [{ type: "http", url: HOOK_URL, timeout: EVENT_TIMEOUT_SEC }],
  });
  return {
    hooks: {
      SessionStart: [relay()],
      UserPromptSubmit: [relay()],
      PreToolUse: [relay()],
      PostToolUse: [relay()],
      PostToolUseFailure: [relay()],
      Stop: [relay()],
      Notification: [relay()],
      SubagentStart: [relay()],
      SubagentStop: [relay()],
      SessionEnd: [relay()],
    },
  };
}

function installGrokHooks(configPath) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify(buildGrokHookFile(), null, 2),
    "utf8"
  );
  // Remove legacy double-hook file that caused 2 cards for one Grok terminal
  const legacy = path.join(path.dirname(configPath), "vibe-island.json");
  if (fs.existsSync(legacy)) {
    try {
      fs.unlinkSync(legacy);
    } catch {
      /* ignore */
    }
  }
}

function installCursorHooks(configPath, hookScript) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  let existing = {};
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, "utf8") || "{}");
    } catch {
      existing = {};
    }
  }
  // Cursor often uses top-level event keys or hooks object
  const commandHooks = buildCommandHooks(hookScript);
  if (!existing.hooks) existing.hooks = {};
  for (const [ev, groups] of Object.entries(commandHooks)) {
    existing.hooks[ev] = [...stripWinsurHooks(existing.hooks[ev]), ...groups];
  }
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), "utf8");
}

function installHooksToConfig(configPath, hookScript, hooksKey, preferHttp, gate) {
  let settings = {};
  if (fs.existsSync(configPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(configPath, "utf8") || "{}");
    } catch {
      settings = {};
    }
  } else {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
  }

  const hooks = preferHttp ? buildHttpHooks(gate) : buildCommandHooks(hookScript);
  if (!settings[hooksKey] || typeof settings[hooksKey] !== "object") {
    settings[hooksKey] = {};
  }
  const existing = settings[hooksKey];
  for (const [eventName, groups] of Object.entries(hooks)) {
    existing[eventName] = [...stripWinsurHooks(existing[eventName]), ...groups];
  }
  fs.writeFileSync(configPath, JSON.stringify(settings, null, 2), "utf8");
}

function uninstallFromConfig(configPath, hooksKey) {
  if (!configPath || !fs.existsSync(configPath)) return;
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return;
  }
  if (!settings[hooksKey] || typeof settings[hooksKey] !== "object") return;
  for (const eventName of Object.keys(settings[hooksKey])) {
    settings[hooksKey][eventName] = stripWinsurHooks(settings[hooksKey][eventName]);
  }
  fs.writeFileSync(configPath, JSON.stringify(settings, null, 2), "utf8");
}

function installAllHooks() {
  const hookScript = getHookScriptPath();
  if (!hookScript) throw new Error("Cannot find hooks/winsur-hook.ps1");

  const hosts = getAgentHosts();
  const installed = [];
  const skipped = [];
  const errors = [];

  for (const host of hosts) {
    if (!host.configPath) {
      skipped.push(host.name);
      continue;
    }
    if (!isDetected(host)) {
      skipped.push(host.name);
      continue;
    }
    try {
      if (host.kind === "grok") {
        installGrokHooks(host.configPath);
      } else if (host.kind === "cursor") {
        installCursorHooks(host.configPath, hookScript);
      } else {
        const preferHttp =
          host.key === "claude_code" ||
          host.key === "claude_desktop" ||
          host.typeId === "claude-code";
        // Only Claude Code's PreToolUse decision protocol is verified, so it is
        // the only host whose tool calls we actually hold. Everything else
        // reports activity and falls through to its own permission flow.
        const gate = host.key === "claude_code";
        installHooksToConfig(host.configPath, hookScript, host.hooksKey, preferHttp, gate);
      }
      installed.push(host.name);
    } catch (e) {
      errors.push(`${host.name}: ${e.message}`);
    }
  }

  const parts = [];
  if (installed.length) parts.push(`Installed: ${installed.join(", ")}`);
  if (skipped.length) parts.push(`Not detected (${skipped.length}): ${skipped.slice(0, 8).join(", ")}${skipped.length > 8 ? "…" : ""}`);
  if (errors.length) parts.push(`Failed: ${errors.join("; ")}`);
  const msg = parts.join("\n") || "Nothing to install";
  if (!installed.length && errors.length) throw new Error(msg);
  return msg;
}

function uninstallAllHooks() {
  const hosts = getAgentHosts();
  const uninstalled = [];
  for (const host of hosts) {
    if (!host.configPath) continue;
    try {
      if (host.kind === "grok" && fs.existsSync(host.configPath)) {
        fs.unlinkSync(host.configPath);
        uninstalled.push(host.name);
      } else {
        uninstallFromConfig(host.configPath, host.hooksKey);
        if (fs.existsSync(host.configPath)) uninstalled.push(host.name);
      }
    } catch {
      /* ignore */
    }
  }
  return uninstalled.length
    ? `Uninstalled: ${uninstalled.join(", ")}`
    : "No hooks to uninstall";
}

function checkHooksStatus() {
  const status = {};
  for (const host of getAgentHosts()) {
    const entry = {
      installed: false,
      detected: isDetected(host),
      path: host.configPath,
      name: host.name,
      typeId: host.typeId,
    };
    if (host.configPath && fs.existsSync(host.configPath)) {
      try {
        const content = fs.readFileSync(host.configPath, "utf8");
        entry.installed =
          content.includes("vibe-island") ||
          content.includes("winsur-hook") ||
          content.includes("winsur.json") ||
          content.includes("18900");
      } catch {
        /* ignore */
      }
    }
    status[host.key] = entry;
  }
  status.hook_script = getHookScriptPath();
  status.agent_count = getAgentHosts().length;
  return status;
}

function autoInstallOnLaunch() {
  try {
    const msg = installAllHooks();
    console.log("[hooks] auto-install:", msg.replace(/\n/g, " | "));
    return msg;
  } catch (e) {
    console.warn("[hooks] auto-install skipped:", e.message);
    return String(e.message || e);
  }
}

module.exports = {
  installAllHooks,
  uninstallAllHooks,
  checkHooksStatus,
  getHookScriptPath,
  getHooksDir,
  getAgentHosts,
  autoInstallOnLaunch,
  buildHttpHooks,
  stripWinsurHooks,
};
