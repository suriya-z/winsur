// Session manager — one card per agent terminal, correct idle/working lifecycle

const crypto = require("crypto");

function nowIso() {
  return new Date().toISOString();
}

function normCwd(cwd) {
  return String(cwd || "")
    .trim()
    .replace(/\//g, "\\")
    .replace(/\\+$/, "")
    .toLowerCase();
}

/** One Winsur card per agent product + folder */
function displayKey(agentType, cwd, remoteHost) {
  return `${agentType || "unknown"}|${normCwd(cwd)}|${remoteHost || ""}`;
}

function isNoiseIdleMessage(msg, ntype) {
  const t = String(ntype || "")
    .toLowerCase()
    .replace(/[-_]/g, "");
  if (
    t === "idleprompt" ||
    t === "idle" ||
    t === "agentidle" ||
    t === "turncomplete" ||
    t === "complete"
  ) {
    return true;
  }
  const m = String(msg || "")
    .toLowerCase()
    .trim();
  if (!m) return true;
  const noise = [
    "waiting for your input",
    "awaiting your input",
    "waiting for input",
    "needs your input",
    "need your input",
    "needs your attention",
    "ready for your",
    "your input...",
    "awaiting input",
    "idle",
    "turn complete",
    "task complete",
    "finished",
  ];
  return noise.some((n) => m.includes(n));
}

const EVENT_ALIASES = {
  pre_tool_use: "PreToolUse",
  post_tool_use: "PostToolUse",
  post_tool_use_failure: "PostToolUseFailure",
  session_start: "SessionStart",
  session_end: "SessionEnd",
  user_prompt_submit: "UserPromptSubmit",
  stop: "Stop",
  stop_failure: "StopFailure",
  notification: "Notification",
  subagent_start: "SubagentStart",
  subagent_stop: "SubagentStop",
  subagent_end: "SubagentStop",
  pre_compact: "PreCompact",
  post_compact: "PostCompact",
  permission_denied: "PermissionDenied",
  sessionStart: "SessionStart",
  sessionEnd: "SessionEnd",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  postToolUseFailure: "PostToolUseFailure",
  beforeSubmitPrompt: "UserPromptSubmit",
  subagentStart: "SubagentStart",
  subagentStop: "SubagentStop",
  preCompact: "PreCompact",
};

function normalizeHookPayload(raw) {
  if (!raw || typeof raw !== "object") return {};
  const p = { ...raw };

  if (p.hook_event_name == null && p.hookEventName != null) p.hook_event_name = p.hookEventName;
  if (p.session_id == null && p.sessionId != null) p.session_id = p.sessionId;
  if (p.tool_name == null && p.toolName != null) p.tool_name = p.toolName;
  if (p.tool_input == null && p.toolInput != null) p.tool_input = p.toolInput;
  if (p.tool_response == null && p.toolResponse != null) p.tool_response = p.toolResponse;
  if (p.transcript_path == null && p.transcriptPath != null) p.transcript_path = p.transcriptPath;
  if (p.notification_type == null && p.notificationType != null)
    p.notification_type = p.notificationType;
  if (p.agent_type == null && p.agentType != null) p.agent_type = p.agentType;
  if (p.permission_mode == null && p.permissionMode != null) p.permission_mode = p.permissionMode;
  if (!p.cwd && p.workspaceRoot) p.cwd = p.workspaceRoot;
  if (!p.cwd && p.workspace_root) p.cwd = p.workspace_root;

  let ev = p.hook_event_name || p.hookEventName || "Unknown";
  if (EVENT_ALIASES[ev]) ev = EVENT_ALIASES[ev];
  p.hook_event_name = ev;
  return p;
}

function inferAgentType(payload) {
  const path = String(payload.transcript_path || payload.cwd || "").toLowerCase();
  const checks = [
    [".grok", "grok-build"],
    ["grok", "grok-build"],
    [".claude", "claude-code"],
    ["claude", "claude-code"],
    [".codex", "codex"],
    ["codex", "codex"],
    [".cursor", "cursor"],
    ["antigravity", "antigravity"],
    ["opencode", "opencode"],
    ["qwen", "qwen-code"],
    ["codebuddy", "code-buddy"],
    ["windsurf", "windsurf"],
    ["gemini", "gemini"],
    ["zcode", "zcode"],
    ["trae", "trae"],
    ["kimi", "kimi"],
    ["deepseek", "deepseek"],
    ["mistral", "mistral"],
  ];
  for (const [needle, id] of checks) {
    if (path.includes(needle)) return id;
  }

  if (payload.permission_mode != null && payload.workspaceRoot == null) return "claude-code";

  const at = String(payload.agent_type || "")
    .toLowerCase()
    .replace(/_/g, "-");
  const map = {
    "grok-build": "grok-build",
    grok: "grok-build",
    "claude-code": "claude-code",
    codex: "codex",
    cursor: "cursor",
    antigravity: "antigravity",
    "claude-desktop": "claude-desktop",
    opencode: "opencode",
    "qwen-code": "qwen-code",
    qwen: "qwen-code",
    "code-buddy": "code-buddy",
    windsurf: "windsurf",
    gemini: "gemini",
    kimi: "kimi",
    deepseek: "deepseek",
    mistral: "mistral",
  };
  if (map[at]) return map[at];

  const model = String(payload.model || "").toLowerCase();
  if (model.includes("grok")) return "grok-build";
  if (model.includes("claude")) return "claude-code";
  if (model.includes("gpt") || model.includes("codex")) return "codex";
  if (model.includes("gemini")) return "gemini";

  if (payload.sessionId != null || payload.workspaceRoot != null) return "grok-build";
  return "unknown";
}

// How long after last tool activity before we show Done (if no Stop event)
const IDLE_AFTER_MS = 6000;

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.permissionWaiters = new Map();
    /** displayKey → session id */
    this.displayIndex = new Map();
    /** session id → timeout handle for auto-idle */
    this.idleTimers = new Map();
    this.onSessionIdle = null; // optional callback(session) for UI push
  }

  setIdleCallback(fn) {
    this.onSessionIdle = fn;
  }

  scheduleIdle(sessionId) {
    if (this.idleTimers.has(sessionId)) {
      clearTimeout(this.idleTimers.get(sessionId));
    }
    const t = setTimeout(() => {
      this.idleTimers.delete(sessionId);
      const s = this.sessions.get(sessionId);
      if (!s) return;
      // Only auto-idle if still "working" and not waiting on user
      if (s.status === "thinking" && !s.pending_permission && !s.pending_question && !s.pending_plan) {
        s.status = "idle";
        s.last_tool = null;
        s.last_event_at = nowIso();
        if (typeof this.onSessionIdle === "function") {
          try {
            this.onSessionIdle({ ...s });
          } catch {
            /* ignore */
          }
        }
      }
    }, IDLE_AFTER_MS);
    this.idleTimers.set(sessionId, t);
  }

  cancelIdle(sessionId) {
    if (this.idleTimers.has(sessionId)) {
      clearTimeout(this.idleTimers.get(sessionId));
      this.idleTimers.delete(sessionId);
    }
  }

  /**
   * Always one card per agent-type + cwd.
   * Multiple Grok session UUIDs / HTTP+PS1 double-fires collapse here.
   */
  getOrCreateSession(payload) {
    const agentType = inferAgentType(payload);
    const cwd = payload.cwd || "";
    const remote = payload.remote_host || null;
    const key = displayKey(agentType, cwd, remote);

    // 1) Existing card for this agent+folder
    const existingId = this.displayIndex.get(key);
    if (existingId && this.sessions.has(existingId)) {
      return this.sessions.get(existingId);
    }

    // 2) Same raw session id already stored under another key — reuse
    const rawId = payload.session_id;
    if (rawId && this.sessions.has(rawId)) {
      const s = this.sessions.get(rawId);
      this.displayIndex.set(key, s.id);
      return s;
    }

    // 3) Any other active session of same agent type with empty/same cwd (Grok often flips cwd)
    if (agentType !== "unknown") {
      for (const s of this.sessions.values()) {
        if (s.agent_type !== agentType) continue;
        if (s.status === "disconnected") continue;
        const sameFolder = !cwd || !s.cwd || normCwd(s.cwd) === normCwd(cwd);
        // Single-product agents (grok): merge all into one card if only one logical terminal
        const singleProduct = ["grok-build", "claude-code", "codex"].includes(agentType);
        if (sameFolder || (singleProduct && !cwd)) {
          this.displayIndex.set(key, s.id);
          if (cwd && !s.cwd) s.cwd = cwd;
          return s;
        }
      }
    }

    // 4) Brand new card
    const parts = cwd.split(/[/\\]/).filter(Boolean);
    const name = parts[parts.length - 1] || agentType || "Agent";
    const id = rawId || crypto.randomUUID();
    const session = {
      id,
      agent_type: agentType,
      status: "idle",
      name,
      cwd,
      started_at: nowIso(),
      last_event_at: nowIso(),
      pending_permission: null,
      pending_question: null,
      pending_plan: null,
      last_tool: null,
      remote_host: remote,
    };
    this.sessions.set(id, session);
    this.displayIndex.set(key, id);
    return session;
  }

  handleEvent(rawPayload) {
    const payload = normalizeHookPayload(rawPayload);
    if (!payload.agent_type && (rawPayload?.sessionId || rawPayload?.workspaceRoot)) {
      payload.agent_type = "grok-build";
    }

    const eventName = payload.hook_event_name || "Unknown";
    const session = this.getOrCreateSession(payload);

    // Re-index under current cwd key
    const key = displayKey(session.agent_type, payload.cwd || session.cwd, session.remote_host);
    this.displayIndex.set(key, session.id);

    session.last_event_at = nowIso();
    if (payload.remote_host) session.remote_host = payload.remote_host;
    if (session.pending_plan === undefined) session.pending_plan = null;

    const agentType = inferAgentType(payload);
    if (agentType && agentType !== "unknown") session.agent_type = agentType;
    if (payload.cwd) {
      session.cwd = payload.cwd;
      const parts = payload.cwd.split(/[/\\]/).filter(Boolean);
      if (parts.length) session.name = parts[parts.length - 1];
    }

    switch (eventName) {
      case "SessionStart":
        session.status = "idle";
        session.last_tool = null;
        this.cancelIdle(session.id);
        break;

      case "UserPromptSubmit":
        // User sent a message — agent will work
        session.status = "thinking";
        session.last_tool = "prompt";
        session.pending_question = null;
        this.scheduleIdle(session.id);
        break;

      case "PreToolUse":
        session.status = "thinking";
        session.last_tool = payload.tool_name || "tool";
        session.pending_question = null;
        session.pending_permission = null;
        this.cancelIdle(session.id); // actively working
        break;

      case "PostToolUse":
      case "PostToolUseFailure":
        session.status = "thinking";
        session.last_tool = payload.tool_name || session.last_tool;
        session.pending_question = null;
        // After tools, if nothing new soon → Done
        this.scheduleIdle(session.id);
        break;

      case "PermissionRequest":
        this.cancelIdle(session.id);
        session.status = "waiting";
        session.pending_permission = {
          tool_name: payload.tool_name || "",
          tool_input: payload.tool_input || {},
          description: payload.message || "",
          timestamp: nowIso(),
        };
        break;

      case "Notification": {
        const ntype = payload.notification_type || "";
        const msg = payload.message || payload.title || "";
        const ntypeNorm = String(ntype).toLowerCase();

        if (ntypeNorm === "permission_prompt" || ntypeNorm === "permission") {
          this.cancelIdle(session.id);
          session.status = "waiting";
          session.pending_permission = {
            tool_name: payload.title || "Permission",
            tool_input: {},
            description: msg,
            timestamp: nowIso(),
          };
          break;
        }

        if (isNoiseIdleMessage(msg, ntype) || ntypeNorm.includes("idle")) {
          this.cancelIdle(session.id);
          session.status = "idle";
          session.pending_question = null;
          session.last_tool = null;
          break;
        }

        if (
          ntypeNorm === "elicitation_dialog" ||
          ntypeNorm === "elicitation" ||
          ntypeNorm === "ask_user"
        ) {
          if (!isNoiseIdleMessage(msg, ntype)) {
            this.cancelIdle(session.id);
            session.status = "waiting";
            session.pending_question = msg || "Agent needs a response";
          } else {
            session.status = "idle";
            session.pending_question = null;
            session.last_tool = null;
          }
          break;
        }
        break;
      }

      case "Question":
      case "AskUser": {
        const msg = payload.message || "";
        if (isNoiseIdleMessage(msg, "question")) {
          session.status = "idle";
          session.pending_question = null;
          session.last_tool = null;
        } else {
          this.cancelIdle(session.id);
          session.status = "waiting";
          session.pending_question = msg || "Agent needs a response";
        }
        break;
      }

      case "SubagentStart":
        session.status = "thinking";
        session.last_tool = "subagent";
        this.cancelIdle(session.id);
        break;

      case "SubagentStop":
        session.status = "thinking";
        session.last_tool = "subagent done";
        this.scheduleIdle(session.id);
        break;

      case "Stop":
      case "StopFailure":
        this.cancelIdle(session.id);
        session.status = "idle";
        session.pending_permission = null;
        session.pending_question = null;
        session.last_tool = null;
        break;

      case "SessionEnd":
        this.cancelIdle(session.id);
        session.status = "disconnected";
        session.last_tool = null;
        break;

      case "Plan":
      case "ExitPlanMode":
      case "plan_submit":
      case "PlanSubmit":
      case "ShowPlan": {
        const planText =
          payload.plan ||
          payload.message ||
          payload.tool_input?.plan ||
          payload.toolInput?.plan ||
          "";
        if (planText && String(planText).trim().length > 8) {
          this.cancelIdle(session.id);
          session.status = "waiting";
          session.pending_plan = {
            markdown: String(planText),
            title: payload.title || "Plan review",
            timestamp: nowIso(),
          };
        }
        break;
      }

      default: {
        const tool = String(payload.tool_name || "").toLowerCase();
        if ((tool.includes("plan") || tool === "exitplanmode") && (payload.tool_input || payload.message)) {
          const planText =
            payload.tool_input?.plan ||
            payload.message ||
            JSON.stringify(payload.tool_input || {}, null, 2);
          if (planText && String(planText).length > 40) {
            this.cancelIdle(session.id);
            session.status = "waiting";
            session.pending_plan = {
              markdown: String(planText),
              title: payload.tool_name || "Plan",
              timestamp: nowIso(),
            };
          }
        }
        break;
      }
    }

    return { ...session };
  }

  getSessions() {
    // Hard dedupe by display key
    const byKey = new Map();
    for (const s of this.sessions.values()) {
      if (s.status === "disconnected") continue;
      const key = displayKey(s.agent_type, s.cwd, s.remote_host);
      const prev = byKey.get(key);
      if (
        !prev ||
        new Date(s.last_event_at).getTime() > new Date(prev.last_event_at).getTime()
      ) {
        byKey.set(key, s);
      }
    }

    // Extra: only ONE card per agent product if multiple empty-cwd clones
    const byType = new Map();
    for (const s of byKey.values()) {
      const t = s.agent_type || "unknown";
      const prev = byType.get(t);
      if (!prev) {
        byType.set(t, s);
        continue;
      }
      // Same product, different folders → keep both only if both have real distinct cwds
      const a = normCwd(prev.cwd);
      const b = normCwd(s.cwd);
      if (a && b && a !== b) {
        // keep both under composite — use display key already
        byType.set(`${t}::${b}`, s);
        byType.set(`${t}::${a}`, prev);
        byType.delete(t);
      } else {
        // merge: keep newer
        if (new Date(s.last_event_at) > new Date(prev.last_event_at)) byType.set(t, s);
      }
    }

    // Prefer byKey (folder-aware) as source of truth
    return Array.from(byKey.values())
      .map((s) => ({ ...s }))
      .sort(
        (a, b) =>
          new Date(b.last_event_at).getTime() - new Date(a.last_event_at).getTime()
      );
  }

  respondPermission(sessionId, decision) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pending_permission = null;
      session.status = "thinking";
      this.scheduleIdle(sessionId);
    }
    const waiter = this.permissionWaiters.get(sessionId);
    if (waiter) {
      waiter.resolve(decision);
      return true;
    }
    // Also try display-index primary
    for (const s of this.sessions.values()) {
      if (s.id === sessionId) continue;
    }
    return false;
  }

  waitPermission(sessionId, timeoutMs = 300000) {
    return new Promise((resolve) => {
      const prev = this.permissionWaiters.get(sessionId);
      if (prev) {
        clearTimeout(prev.timeout);
        prev.resolve("deny");
      }
      const timeout = setTimeout(() => {
        this.permissionWaiters.delete(sessionId);
        this.respondPermission(sessionId, "deny");
        resolve("deny");
      }, timeoutMs);
      this.permissionWaiters.set(sessionId, {
        resolve: (decision) => {
          clearTimeout(timeout);
          this.permissionWaiters.delete(sessionId);
          resolve(decision);
        },
        timeout,
      });
    });
  }

  clearQuestion(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.pending_question = null;
    if (session.status === "waiting" && !session.pending_plan && !session.pending_permission) {
      session.status = "thinking";
      this.scheduleIdle(sessionId);
    }
  }

  clearPlan(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.pending_plan = null;
    if (session.status === "waiting" && !session.pending_question && !session.pending_permission) {
      session.status = "thinking";
      this.scheduleIdle(sessionId);
    }
  }

  removeSession(sessionId) {
    this.cancelIdle(sessionId);
    const s = this.sessions.get(sessionId);
    if (s) {
      this.displayIndex.delete(displayKey(s.agent_type, s.cwd, s.remote_host));
    }
    this.sessions.delete(sessionId);
    const waiter = this.permissionWaiters.get(sessionId);
    if (waiter) waiter.resolve("deny");
  }

  clearAll() {
    for (const id of [...this.idleTimers.keys()]) this.cancelIdle(id);
    this.sessions.clear();
    this.displayIndex.clear();
    for (const [, w] of this.permissionWaiters) {
      try {
        w.resolve("deny");
      } catch {
        /* ignore */
      }
    }
    this.permissionWaiters.clear();
  }
}

module.exports = {
  SessionManager,
  inferAgentType,
  normalizeHookPayload,
  displayKey,
};
