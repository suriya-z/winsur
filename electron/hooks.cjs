// Zero-config hook installer — all agents from agents-registry.cjs

const fs = require("fs");
const path = require("path");
const { getAgentRegistry } = require("./agents-registry.cjs");

const HOOK_URL = "http://127.0.0.1:18900/hooks/event";

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
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, "hooks");
    if (fs.existsSync(path.join(packaged, "winsur-hook.ps1"))) return packaged;
    if (fs.existsSync(path.join(packaged, "vibe-island-hook.ps1"))) return packaged;
  }
  const dev = path.join(__dirname, "..", "hooks");
  if (fs.existsSync(path.join(dev, "winsur-hook.ps1"))) return dev;
  if (fs.existsSync(path.join(dev, "vibe-island-hook.ps1"))) return dev;
  const cwd = path.join(process.cwd(), "hooks");
  if (fs.existsSync(path.join(cwd, "winsur-hook.ps1"))) return cwd;
  if (fs.existsSync(path.join(cwd, "vibe-island-hook.ps1"))) return cwd;
  return dev;
}

function getHookScriptPath() {
  const dir = getHooksDir();
  for (const name of ["winsur-hook.ps1", "vibe-island-hook.ps1"]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
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

function buildHttpHooks() {
  return {
    PreToolUse: [{ type: "http", url: HOOK_URL, timeout: 5 }],
    PostToolUse: [{ type: "http", url: HOOK_URL, timeout: 5 }],
    Notification: [{ type: "http", url: HOOK_URL, timeout: 5 }],
    Stop: [{ type: "http", url: HOOK_URL, timeout: 5 }],
    SessionStart: [{ type: "http", url: HOOK_URL, timeout: 5 }],
    SessionEnd: [{ type: "http", url: HOOK_URL, timeout: 5 }],
  };
}

function buildCommandHooks(scriptPath) {
  const ev = ["PreToolUse", "PostToolUse", "Notification", "Stop", "SessionStart", "SessionEnd"];
  const hooks = {};
  for (const e of ev) {
    hooks[e] = [{ type: "command", command: hookCommand(scriptPath, e) }];
  }
  return hooks;
}

/** Grok: HTTP only — dual HTTP+command double-fires and creates 2 cards */
function buildGrokHookFile(_hookScriptPath) {
  const http = (t = 5) => ({ type: "http", url: HOOK_URL, timeout: t });
  const one = (e) => ({ hooks: [http(5)] });
  return {
    hooks: {
      SessionStart: [one("SessionStart")],
      UserPromptSubmit: [one("UserPromptSubmit")],
      PreToolUse: [one("PreToolUse")],
      PostToolUse: [one("PostToolUse")],
      PostToolUseFailure: [one("PostToolUseFailure")],
      Stop: [one("Stop")],
      Notification: [one("Notification")],
      SubagentStart: [one("SubagentStart")],
      SubagentStop: [one("SubagentStop")],
      SessionEnd: [one("SessionEnd")],
    },
  };
}

function injectScriptPaths(config, hookScriptPath) {
  const cmdBase = `powershell -ExecutionPolicy Bypass -NoProfile -File "${hookScriptPath}"`;
  const hooks = config.hooks || {};
  for (const [eventName, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!Array.isArray(group.hooks)) continue;
      for (const h of group.hooks) {
        if (h && h.type === "command") {
          const parts = String(h.command || "").trim().split(/\s+/);
          const last = parts[parts.length - 1];
          const eventArg = /^[A-Za-z]+$/.test(last) ? last : eventName;
          h.command = `${cmdBase} ${eventArg}`;
        }
      }
    }
  }
  return config;
}

function installGrokHooks(configPath) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const hookScript = getHookScriptPath();
  fs.writeFileSync(
    configPath,
    JSON.stringify(buildGrokHookFile(hookScript || ""), null, 2),
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
  for (const [ev, entries] of Object.entries(commandHooks)) {
    if (!Array.isArray(existing.hooks[ev])) existing.hooks[ev] = [];
    existing.hooks[ev] = existing.hooks[ev].filter((e) => {
      const c = e?.command || "";
      const u = e?.url || "";
      return (
        !String(c).includes("vibe-island") &&
        !String(c).includes("winsur-hook") &&
        !String(u).includes("18900")
      );
    });
    existing.hooks[ev].push(...entries);
  }
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), "utf8");
}

function installHooksToConfig(configPath, hookScript, hooksKey, preferHttp) {
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

  const hooks = preferHttp ? buildHttpHooks() : buildCommandHooks(hookScript);
  if (!settings[hooksKey] || typeof settings[hooksKey] !== "object") {
    settings[hooksKey] = {};
  }
  const existing = settings[hooksKey];
  for (const [eventName, entries] of Object.entries(hooks)) {
    if (!Array.isArray(existing[eventName])) existing[eventName] = [];
    existing[eventName] = existing[eventName].filter((entry) => {
      const cmd = entry?.command || "";
      const url = entry?.url || "";
      return (
        !String(cmd).includes("vibe-island") &&
        !String(cmd).includes("winsur-hook") &&
        !String(url).includes("18900")
      );
    });
    existing[eventName].push(...entries);
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
    const arr = settings[hooksKey][eventName];
    if (!Array.isArray(arr)) continue;
    settings[hooksKey][eventName] = arr.filter((entry) => {
      const cmd = entry?.command || "";
      const url = entry?.url || "";
      return (
        !String(cmd).includes("vibe-island") &&
        !String(cmd).includes("winsur-hook") &&
        !String(url).includes("18900")
      );
    });
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
        installHooksToConfig(host.configPath, hookScript, host.hooksKey, preferHttp);
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
};
