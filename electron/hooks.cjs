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
    binNames: a.binNames || [],
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

function findBinInPath(binNames) {
  if (!Array.isArray(binNames) || !binNames.length) return false;
  const pathEnv = process.env.PATH || "";
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const appDataNpm = process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : null;
  if (appDataNpm && !dirs.includes(appDataNpm)) dirs.push(appDataNpm);

  const exts = process.platform === "win32" ? [".exe", ".cmd", ".ps1", ".bat", ""] : [""];
  for (const bin of binNames) {
    for (const dir of dirs) {
      for (const ext of exts) {
        try {
          if (fs.existsSync(path.join(dir, bin + ext))) return true;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return false;
}

function isDetected(host) {
  if (host.configPath && fs.existsSync(host.configPath)) return true;
  for (const d of host.detectDirs || []) {
    if (d && fs.existsSync(d)) return true;
  }
  if (findBinInPath(host.binNames)) return true;
  return false;
}

function hookCommand(scriptPath, eventName, hostTypeId) {
  const suffix = hostTypeId ? ` ${hostTypeId}` : "";
  if (scriptPath.includes(" ")) {
    return `powershell -ExecutionPolicy Bypass -NoProfile -Command "& '${scriptPath}' ${eventName}${suffix}"`;
  }
  return `powershell -ExecutionPolicy Bypass -NoProfile -File ${scriptPath} ${eventName}${suffix}`;
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

function buildCommandHooks(scriptPath, hostTypeId) {
  const hooks = {};
  for (const e of HOOK_EVENTS) {
    hooks[e] = [
      {
        hooks: [
          {
            type: "command",
            command: hookCommand(scriptPath, e, hostTypeId),
            commandWindows: hookCommand(scriptPath, e, hostTypeId),
          },
        ],
      },
    ];
  }
  return hooks;
}

/** True for a handler this app installed (any generation of it). */
function isWinsurHandler(handler) {
  const cmd = String(handler?.command || "");
  const cmdWin = String(handler?.commandWindows || "");
  const url = String(handler?.url || "");
  return (
    cmd.includes("vibe-island") ||
    cmd.includes("winsur-hook") ||
    cmdWin.includes("winsur-hook") ||
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

/**
 * Cursor's hooks.json is NOT Claude's nested { matcher, hooks: [{ type, command }] }.
 * It is { version: 1, hooks: { sessionStart: [{ command }] } } with camelCase
 * event names. The nested shape parses as an invalid hook and never fires, so
 * an already-running Cursor stayed invisible even after the next agent turn.
 *
 * Permission hooks (preToolUse, beforeShellExecution, …) are intentionally
 * omitted: Cursor blocks the action when those commands print empty stdout.
 * Observation hooks are enough to recognize the session; the script prints
 * {"continue":true} for beforeSubmitPrompt so sending a prompt is not blocked.
 */
function cursorHookCommand(scriptPath, eventName) {
  const quoted = String(scriptPath).replace(/'/g, "''");
  // Cursor runs the command string inside PowerShell and pipes the hook JSON
  // into that process. A nested `powershell -File` does not inherit that
  // pipeline, so the script saw an empty body. Pipe $input into the script.
  return `$input | & '${quoted}' ${eventName} cursor`;
}

function buildCursorHooks(hookScript) {
  const events = [
    "sessionStart",
    "sessionEnd",
    "beforeSubmitPrompt",
    "postToolUse",
    "postToolUseFailure",
    "stop",
    "subagentStop",
    "afterAgentResponse",
    "afterAgentThought",
    "workspaceOpen",
  ];
  const hooks = {};
  for (const ev of events) {
    hooks[ev] = [
      {
        command: cursorHookCommand(hookScript, ev),
        timeout: EVENT_TIMEOUT_SEC,
      },
    ];
  }
  return hooks;
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
  if (!existing.hooks || typeof existing.hooks !== "object" || Array.isArray(existing.hooks)) {
    existing.hooks = {};
  }
  for (const key of Object.keys(existing.hooks)) {
    const kept = stripWinsurHooks(existing.hooks[key]);
    if (kept.length) existing.hooks[key] = kept;
    else delete existing.hooks[key];
  }
  const commandHooks = buildCursorHooks(hookScript);
  for (const [ev, handlers] of Object.entries(commandHooks)) {
    existing.hooks[ev] = [...stripWinsurHooks(existing.hooks[ev]), ...handlers];
  }
  if (existing.version == null) existing.version = 1;
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), "utf8");
}

function installCodexHooks(configPath, hookScript) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  let existing = {};
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, "utf8") || "{}");
    } catch {
      existing = {};
    }
  }
  if (!existing.hooks || typeof existing.hooks !== "object") {
    existing.hooks = {};
  }
  const codexEvents = [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "Stop",
    "SessionEnd",
  ];
  for (const ev of codexEvents) {
    const cmd = hookCommand(hookScript, ev, "codex");
    const group = {
      hooks: [
        {
          type: "command",
          command: cmd,
          commandWindows: cmd,
          timeout: EVENT_TIMEOUT_SEC,
        },
      ],
    };
    existing.hooks[ev] = [...stripWinsurHooks(existing.hooks[ev]), group];
  }
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), "utf8");
}

function installAntigravityHooks(configPath, hookScript) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  let existing = {};
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, "utf8") || "{}");
    } catch {
      existing = {};
    }
  }
  const cmd = (ev) => hookCommand(hookScript, ev, "antigravity");
  existing.winsur = {
    PreToolUse: [
      {
        matcher: ".*",
        hooks: [{ type: "command", command: cmd("PreToolUse") }],
      },
    ],
    PostToolUse: [
      {
        matcher: ".*",
        hooks: [{ type: "command", command: cmd("PostToolUse") }],
      },
    ],
    PreInvocation: [
      {
        type: "command",
        command: cmd("SessionStart"),
      },
    ],
    Stop: [
      {
        type: "command",
        command: cmd("Stop"),
      },
    ],
  };
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), "utf8");
}

function uninstallAntigravityHooks(configPath) {
  if (!configPath || !fs.existsSync(configPath)) return;
  try {
    const existing = JSON.parse(fs.readFileSync(configPath, "utf8") || "{}");
    if (existing.winsur) {
      delete existing.winsur;
      fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), "utf8");
    }
  } catch {
    /* ignore */
  }
}

function buildOpenCodePluginSource() {
  return `// Winsur zero-config plugin for OpenCode
const HOOK_URL = "${HOOK_URL}";

async function postWinsur(payload) {
  try {
    await fetch(HOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Winsur offline — fail open
  }
}

export default async ({ directory, worktree }) => {
  const cwd = directory || worktree || process.cwd();
  void postWinsur({
    hook_event_name: "SessionStart",
    session_id: "opencode-" + Buffer.from(String(cwd)).toString("hex").slice(0, 16),
    cwd,
    agent_type: "opencode",
  });

  return {
    "chat.message": async (input) => {
      await postWinsur({
        hook_event_name: "UserPromptSubmit",
        session_id: input?.sessionID || "opencode",
        cwd,
        agent_type: "opencode",
      });
    },
    "tool.execute.before": async (input, output) => {
      await postWinsur({
        hook_event_name: "PreToolUse",
        session_id: input?.sessionID || "opencode",
        tool_name: input?.tool || "tool",
        tool_input: output?.args || {},
        cwd,
        agent_type: "opencode",
      });
    },
    "tool.execute.after": async (input) => {
      await postWinsur({
        hook_event_name: "PostToolUse",
        session_id: input?.sessionID || "opencode",
        tool_name: input?.tool || "tool",
        cwd,
        agent_type: "opencode",
      });
    },
    "permission.ask": async (input) => {
      await postWinsur({
        hook_event_name: "Notification",
        notification_type: "permission_prompt",
        session_id: input?.sessionID || "opencode",
        title: input?.title || "Permission",
        message: input?.title || "OpenCode needs permission",
        cwd,
        agent_type: "opencode",
      });
    },
    event: async ({ event }) => {
      const t = String(event?.type || "");
      if (t === "session.idle" || t === "session.status") {
        const isIdle = t === "session.idle" || event?.properties?.status?.type === "idle";
        if (isIdle) {
          await postWinsur({
            hook_event_name: "Stop",
            session_id: event?.properties?.sessionID || "opencode",
            cwd,
            agent_type: "opencode",
          });
        }
      }
    },
  };
};
`;
}

function installOpenCodeHooks(pluginFilePath) {
  const pluginsDir = path.dirname(pluginFilePath);
  fs.mkdirSync(pluginsDir, { recursive: true });
  fs.writeFileSync(pluginFilePath, buildOpenCodePluginSource(), "utf8");

  const configDir = path.dirname(pluginsDir);
  const jsoncPath = path.join(configDir, "opencode.jsonc");
  const fileUrl = "file:///" + pluginFilePath.replace(/\\/g, "/");
  if (fs.existsSync(jsoncPath)) {
    try {
      const raw = fs.readFileSync(jsoncPath, "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.plugin)) parsed.plugin = [];
      if (!parsed.plugin.some((p) => String(p).includes("winsur"))) {
        parsed.plugin.push(fileUrl);
        fs.writeFileSync(jsoncPath, JSON.stringify(parsed, null, 2), "utf8");
      }
    } catch {
      /* ignore */
    }
  }
}

function uninstallOpenCodeHooks(pluginFilePath) {
  if (pluginFilePath && fs.existsSync(pluginFilePath)) {
    try {
      fs.unlinkSync(pluginFilePath);
    } catch {
      /* ignore */
    }
  }
  const configDir = path.dirname(path.dirname(pluginFilePath));
  const jsoncPath = path.join(configDir, "opencode.jsonc");
  if (fs.existsSync(jsoncPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(jsoncPath, "utf8"));
      if (Array.isArray(parsed.plugin)) {
        parsed.plugin = parsed.plugin.filter((p) => !String(p).includes("winsur"));
        fs.writeFileSync(jsoncPath, JSON.stringify(parsed, null, 2), "utf8");
      }
    } catch {
      /* ignore */
    }
  }
}

function buildHermesPluginManifest() {
  return `name: winsur
version: 0.1.1
description: Forward Hermes Agent lifecycle and tool events to Winsur control surface
author: Winsur
kind: standalone
manifest_version: 2
provides_hooks:
  - on_session_start
  - on_session_end
  - pre_llm_call
  - pre_tool_call
  - post_tool_call
  - on_stream_end
`;
}

function buildHermesPluginInit() {
  return `"""Winsur bridge plugin for Hermes Agent."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from urllib import request as urlrequest

HOOK_URL = "${HOOK_URL}"


def _post_event(payload: dict) -> None:
    def _send():
        try:
            body = json.dumps(payload, default=str).encode("utf-8")
            req = urlrequest.Request(
                HOOK_URL,
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urlrequest.urlopen(req, timeout=2.5):
                pass
        except Exception:
            pass

    threading.Thread(target=_send, daemon=True).start()


def _cwd(kwargs: dict) -> str:
    c = kwargs.get("cwd")
    if c:
        return str(c)
    try:
        return str(Path.cwd())
    except Exception:
        return os.environ.get("USERPROFILE", "")


def _sid(kwargs: dict) -> str:
    return str(
        kwargs.get("session_id")
        or kwargs.get("parent_session_id")
        or "hermes-main"
    )


def register(ctx) -> None:
    def on_session_start(**kwargs):
        _post_event({
            "hook_event_name": "SessionStart",
            "session_id": _sid(kwargs),
            "cwd": _cwd(kwargs),
            "agent_type": "hermes",
        })

    def pre_llm_call(**kwargs):
        _post_event({
            "hook_event_name": "UserPromptSubmit",
            "session_id": _sid(kwargs),
            "cwd": _cwd(kwargs),
            "agent_type": "hermes",
        })

    def pre_tool_call(**kwargs):
        _post_event({
            "hook_event_name": "PreToolUse",
            "session_id": _sid(kwargs),
            "tool_name": kwargs.get("tool_name") or "tool",
            "tool_input": kwargs.get("args") if isinstance(kwargs.get("args"), dict) else {},
            "cwd": _cwd(kwargs),
            "agent_type": "hermes",
        })

    def post_tool_call(**kwargs):
        _post_event({
            "hook_event_name": "PostToolUse",
            "session_id": _sid(kwargs),
            "tool_name": kwargs.get("tool_name") or "tool",
            "cwd": _cwd(kwargs),
            "agent_type": "hermes",
        })

    def on_stream_end(**kwargs):
        _post_event({
            "hook_event_name": "Stop",
            "session_id": _sid(kwargs),
            "cwd": _cwd(kwargs),
            "agent_type": "hermes",
        })

    def on_session_end(**kwargs):
        _post_event({
            "hook_event_name": "SessionEnd",
            "session_id": _sid(kwargs),
            "cwd": _cwd(kwargs),
            "agent_type": "hermes",
        })

    ctx.register_hook("on_session_start", on_session_start)
    ctx.register_hook("pre_llm_call", pre_llm_call)
    ctx.register_hook("pre_tool_call", pre_tool_call)
    ctx.register_hook("post_tool_call", post_tool_call)
    ctx.register_hook("on_stream_end", on_stream_end)
    ctx.register_hook("on_session_end", on_session_end)
`;
}

function ensureHermesYamlConfig(hermesHome) {
  const cfgPath = path.join(hermesHome, "config.yaml");
  if (!fs.existsSync(cfgPath)) return;
  try {
    let text = fs.readFileSync(cfgPath, "utf8");
    if (text.includes("- winsur") || text.includes('"winsur"')) return;

    if (/^plugins:\s*$/m.test(text)) {
      text = text.replace(/^plugins:\s*$/m, "plugins:\n  enabled:\n    - winsur");
    } else {
      text += "\nplugins:\n  enabled:\n    - winsur\n";
    }
    fs.writeFileSync(cfgPath, text, "utf8");
  } catch {
    /* ignore */
  }
}

function installHermesHooks(pluginInitPath) {
  const pluginDir = path.dirname(pluginInitPath);
  const hermesHome = path.dirname(path.dirname(pluginDir));
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "plugin.yaml"), buildHermesPluginManifest(), "utf8");
  fs.writeFileSync(pluginInitPath, buildHermesPluginInit(), "utf8");
  ensureHermesYamlConfig(hermesHome);

  const dotHermes = path.join(process.env.USERPROFILE || process.env.HOME || "", ".hermes");
  if (fs.existsSync(dotHermes) && path.resolve(dotHermes) !== path.resolve(hermesHome)) {
    const altDir = path.join(dotHermes, "plugins", "winsur");
    fs.mkdirSync(altDir, { recursive: true });
    fs.writeFileSync(path.join(altDir, "plugin.yaml"), buildHermesPluginManifest(), "utf8");
    fs.writeFileSync(path.join(altDir, "__init__.py"), buildHermesPluginInit(), "utf8");
    ensureHermesYamlConfig(dotHermes);
  }
}

function uninstallHermesHooks(pluginInitPath) {
  const pluginDir = path.dirname(pluginInitPath);
  if (fs.existsSync(pluginDir)) {
    try {
      fs.rmSync(pluginDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function installHooksToConfig(configPath, hookScript, hooksKey, preferHttp, gate, hostTypeId) {
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

  const hooks = preferHttp
    ? buildHttpHooks(gate)
    : buildCommandHooks(hookScript, hostTypeId);
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
      } else if (host.kind === "codex") {
        installCodexHooks(host.configPath, hookScript);
      } else if (host.kind === "antigravity") {
        installAntigravityHooks(host.configPath, hookScript);
      } else if (host.kind === "opencode") {
        installOpenCodeHooks(host.configPath);
      } else if (host.kind === "hermes") {
        installHermesHooks(host.configPath);
      } else {
        const preferHttp =
          host.key === "claude_code" ||
          host.key === "claude_desktop" ||
          host.typeId === "claude-code";
        // Only Claude Code's PreToolUse decision protocol is verified, so it is
        // the only host whose tool calls we actually hold. Everything else
        // reports activity and falls through to its own permission flow.
        const gate = host.key === "claude_code";
        installHooksToConfig(
          host.configPath,
          hookScript,
          host.hooksKey,
          preferHttp,
          gate,
          host.typeId
        );
      }
      installed.push(host.name);
    } catch (e) {
      errors.push(`${host.name}: ${e.message}`);
    }
  }

  const parts = [];
  if (installed.length) parts.push(`Installed: ${installed.join(", ")}`);
  if (skipped.length) parts.push(`Not detected (${skipped.length}): ${skipped.slice(0, 8).join(", ")}${skipped.length > 8 ? "..." : ""}`);
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
      } else if (host.kind === "antigravity") {
        uninstallAntigravityHooks(host.configPath);
        uninstalled.push(host.name);
      } else if (host.kind === "opencode") {
        uninstallOpenCodeHooks(host.configPath);
        uninstalled.push(host.name);
      } else if (host.kind === "hermes") {
        uninstallHermesHooks(host.configPath);
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
          content.includes("18900") ||
          content.includes("Winsur");
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
  buildCursorHooks,
  stripWinsurHooks,
};
