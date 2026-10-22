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
  // A real question can mention "finished" or "idle". Only the stock
  // status lines are noise, and only when the whole message is that line.
  if (m.length > 96) return false;
  const exact = new Set(["idle", "finished", "complete", "done", "task complete", "turn complete"]);
  if (exact.has(m)) return true;
  const prefixes = [
    "waiting for your input",
    "awaiting your input",
    "waiting for input",
    "needs your input",
    "need your input",
    "needs your attention",
    "ready for your",
    "your input",
    "awaiting input",
  ];
  return prefixes.some((n) => m === n || m.startsWith(`${n} `) || m.startsWith(`${n}.`) || m.startsWith(`${n}…`));
}

const EVENT_ALIASES = {
  pre_tool_use: "PreToolUse",
  post_tool_use: "PostToolUse",
  post_tool_use_failure: "PostToolUseFailure",
  pre_tool_call: "PreToolUse",
  post_tool_call: "PostToolUse",
  pre_llm_call: "UserPromptSubmit",
  post_llm_call: "PostToolUse",
  on_session_start: "SessionStart",
  on_session_end: "SessionEnd",
  on_session_finalize: "Stop",
  on_stream_end: "Stop",
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
  workspaceOpen: "SessionStart",
  workspace_open: "SessionStart",
  afterAgentResponse: "AgentActivity",
  afterAgentThought: "AgentActivity",
  beforeShellExecution: "PreToolUse",
  afterShellExecution: "PostToolUse",
  afterFileEdit: "PostToolUse",
  afterMCPExecution: "PostToolUse",
  beforeMCPExecution: "PreToolUse",
};

function normalizeHookPayload(raw) {
  if (!raw || typeof raw !== "object") return {};
  const p = { ...raw };

  if (p.hook_event_name == null && p.hookEventName != null) p.hook_event_name = p.hookEventName;
  if (p.session_id == null && p.sessionId != null) p.session_id = p.sessionId;
  if (p.session_id == null && p.conversationId != null) p.session_id = p.conversationId;
  if (p.session_id == null && p.conversation_id != null) p.session_id = p.conversation_id;
  if (p.tool_name == null && p.toolName != null) p.tool_name = p.toolName;
  if (p.tool_name == null && p.toolCall?.name != null) p.tool_name = p.toolCall.name;
  if (p.tool_input == null && p.toolInput != null) p.tool_input = p.toolInput;
  if (p.tool_input == null && p.toolCall?.args != null) p.tool_input = p.toolCall.args;
  if (p.tool_response == null && p.toolResponse != null) p.tool_response = p.toolResponse;
  if (p.transcript_path == null && p.transcriptPath != null) p.transcript_path = p.transcriptPath;
  if (p.notification_type == null && p.notificationType != null)
    p.notification_type = p.notificationType;
  if (p.agent_type == null && p.agentType != null) p.agent_type = p.agentType;
  if (p.permission_mode == null && p.permissionMode != null) p.permission_mode = p.permissionMode;
  if (!p.cwd && p.workspaceRoot) p.cwd = p.workspaceRoot;
  if (!p.cwd && p.workspace_root) p.cwd = p.workspace_root;
  if (!p.cwd && Array.isArray(p.workspacePaths) && p.workspacePaths.length > 0) {
    p.cwd = p.workspacePaths[0];
  }
  if (!p.cwd && Array.isArray(p.workspace_roots) && p.workspace_roots.length > 0) {
    p.cwd = p.workspace_roots[0];
  }
  if (p.agent_type == null && p.cursor_version != null) p.agent_type = "cursor";

  let ev = p.hook_event_name || p.hookEventName || "Unknown";
  if (EVENT_ALIASES[ev]) ev = EVENT_ALIASES[ev];
  p.hook_event_name = ev;
  return p;
}

const AGENT_TYPE_MAP = {
  "grok-build": "grok-build",
  grok: "grok-build",
  "claude-code": "claude-code",
  claude: "claude-code",
  codex: "codex",
  "codex-cli": "codex",
  cursor: "cursor",
  antigravity: "antigravity",
  "claude-desktop": "claude-desktop",
  opencode: "opencode",
  "qwen-code": "qwen-code",
  qwen: "qwen-code",
  "code-buddy": "code-buddy",
  codebuddy: "code-buddy",
  windsurf: "windsurf",
  gemini: "gemini",
  "gemini-cli": "gemini",
  zcode: "zcode",
  trae: "trae",
  mimocode: "mimocode",
  droid: "droid",
  qoder: "qoder",
  kimi: "kimi",
  deepseek: "deepseek",
  mistral: "mistral",
  copilot: "copilot",
  "github-copilot": "copilot",
  workbuddy: "workbuddy",
  kiro: "kiro",
  hermes: "hermes",
  amp: "amp",
  "pi-agent": "pi-agent",
  pi: "pi-agent",
  "oh-my-pi": "oh-my-pi",
  gajae: "gajae",
};

/** Install-directory markers. Matched on the transcript path, not the project cwd. */
const TRANSCRIPT_MARKERS = [
  ["/.grok/", "grok-build"],
  ["/.claude/", "claude-code"],
  ["/.codex/", "codex"],
  ["/.cursor/", "cursor"],
  ["/.gemini/", "gemini"],
  ["/antigravity/", "antigravity"],
  ["/.opencode/", "opencode"],
  ["/.qwen/", "qwen-code"],
  ["/.codebuddy/", "code-buddy"],
  ["/.hermes/", "hermes"],
  ["/.kimi/", "kimi"],
  ["/.deepseek/", "deepseek"],
  ["/.mistral/", "mistral"],
  ["/.kiro/", "kiro"],
  ["/.windsurf/", "windsurf"],
];

function markerHit(value) {
  const n = String(value || "")
    .replace(/\\/g, "/")
    .toLowerCase();
  if (!n) return null;
  const padded = n.endsWith("/") ? n : `${n}/`;
  for (const [needle, id] of TRANSCRIPT_MARKERS) {
    if (padded.includes(needle)) return id;
  }
  return null;
}

function inferAgentType(payload) {
  const at = String(payload.agent_type || "")
    .toLowerCase()
    .replace(/_/g, "-");
  if (AGENT_TYPE_MAP[at]) return AGENT_TYPE_MAP[at];

  // Cursor's hook payload always carries cursor_version / workspace_roots.
  // Those must win over the Grok camelCase heuristic (sessionId + workspaceRoot),
  // which used to label every camelCase event as Grok.
  if (payload.cursor_version != null) return "cursor";
  if (Array.isArray(payload.workspace_roots) && payload.workspace_roots.length > 0) return "cursor";

  if (payload.conversationId != null || payload.artifactDirectoryPath != null) {
    return "antigravity";
  }
  if (payload.delivery_id != null && payload.profile != null) {
    return "hermes";
  }

  const fromTranscript = markerHit(payload.transcript_path);
  if (fromTranscript) return fromTranscript;

  // Grok's HTTP hooks are camelCase and have no transcript path.
  const looksGrok =
    (payload.hookEventName != null || payload.workspaceRoot != null) &&
    payload.sessionId != null &&
    payload.transcript_path == null &&
    payload.cursor_version == null &&
    payload.workspace_roots == null &&
    payload.conversation_id == null;
  if (looksGrok) return "grok-build";

  if (
    payload.permission_mode != null &&
    payload.workspaceRoot == null &&
    payload.cursor_version == null &&
    payload.workspace_roots == null
  ) {
    return "claude-code";
  }

  const model = String(payload.model || payload.modelName || "").toLowerCase();
  if (payload.cursor_version == null && payload.workspace_roots == null) {
    if (model.includes("grok")) return "grok-build";
    if (model.includes("claude")) return "claude-code";
    if (model.includes("gpt") || model.includes("codex")) return "codex";
    if (model.includes("gemini")) return "gemini";
    if (model.includes("qwen")) return "qwen-code";
  }

  return "unknown";
}

// How long after last tool activity before we show Done (if no Stop event)
const IDLE_AFTER_MS = 6000;

/**
 * One-line summary of what a tool is about to do. PreToolUse payloads carry no
 * message, so without this the permission card shows a bare tool name and you
 * would be approving a command you cannot see.
 */
function describeToolInput(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return "";
  const summary =
    toolInput.command ||
    toolInput.file_path ||
    toolInput.notebook_path ||
    toolInput.path ||
    toolInput.pattern ||
    toolInput.url;
  if (summary) return String(summary);
  try {
    return JSON.stringify(toolInput);
  } catch {
    return "";
  }
}

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.permissionWaiters = new Map();
    /** displayKey → session id */
    this.displayIndex = new Map();
    /** session id → timeout handle for auto-idle */
    this.idleTimers = new Map();
    /** display keys the user dismissed; a later hook event clears the mark */
    this.dismissed = new Set();
    this.onSessionIdle = null; // optional callback(session) for UI push
  }

  reindex(session) {
    for (const [key, id] of this.displayIndex) {
      if (id === session.id) this.displayIndex.delete(key);
    }
    this.displayIndex.set(
      displayKey(session.agent_type, session.cwd, session.remote_host),
      session.id
    );
  }

  publicSession(session) {
    if (!session) return null;
    const copy = { ...session };
    delete copy._hooked;
    delete copy._discovered;
    delete copy.live_pid;
    return copy;
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
    if (typeof t.unref === "function") t.unref();
    this.idleTimers.set(sessionId, t);
  }

  cancelIdle(sessionId) {
    if (this.idleTimers.has(sessionId)) {
      clearTimeout(this.idleTimers.get(sessionId));
      this.idleTimers.delete(sessionId);
    }
  }

  /**
   * One card per agent-type + folder.
   * An empty-cwd placeholder (process discovered before we knew the folder)
   * absorbs the first event that names a cwd. A second folder stays its own card.
   * Events are never glued onto an unrelated folder just because both are Grok.
   */
  getOrCreateSession(payload) {
    const agentType = inferAgentType(payload);
    const cwd = payload.cwd || "";
    const remote = payload.remote_host || null;
    const key = displayKey(agentType, cwd, remote);
    const rawId = payload.session_id ? String(payload.session_id) : "";

    const byKey = this.sessions.get(this.displayIndex.get(key) || "");
    if (byKey && byKey.status !== "disconnected") return byKey;

    if (normCwd(cwd) && agentType !== "unknown") {
      for (const session of this.sessions.values()) {
        if (session.agent_type !== agentType) continue;
        if (session.status === "disconnected") continue;
        if (!normCwd(session.cwd)) {
          session.cwd = cwd;
          if (remote) session.remote_host = remote;
          const parts = cwd.split(/[/\\]/).filter(Boolean);
          if (parts.length) session.name = parts[parts.length - 1];
          this.reindex(session);
          return session;
        }
      }
    }

    if (rawId && this.sessions.has(rawId)) {
      const session = this.sessions.get(rawId);
      if (session.status !== "disconnected") {
        if (cwd && normCwd(session.cwd) !== normCwd(cwd)) {
          session.cwd = cwd;
          const parts = cwd.split(/[/\\]/).filter(Boolean);
          if (parts.length) session.name = parts[parts.length - 1];
        }
        if (agentType !== "unknown") session.agent_type = agentType;
        if (remote) session.remote_host = remote;
        this.reindex(session);
        return session;
      }
    }

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

  /**
   * Card for an agent that is already running. Does not clobber a session
   * that hooks have already updated, and stays gone if the user dismissed it.
   */
  noteDiscovered(info) {
    const agentType = info.agent_type || "unknown";
    const cwd = info.cwd || "";
    const key = displayKey(agentType, cwd, null);
    if (this.dismissed.has(key)) return { created: false, skipped: true, session: null };

    const existed = this.sessions.get(this.displayIndex.get(key) || "");
    const session = this.getOrCreateSession({
      agent_type: agentType,
      cwd,
      session_id: info.id,
      remote_host: null,
    });
    const created = !existed;
    if (created && !session._hooked) {
      session.status = info.status || "idle";
      session.name = info.name || session.name;
      session.cwd = cwd;
      session.last_event_at = info.last_event_at || session.last_event_at;
      session.started_at = info.last_event_at || session.started_at;
      this.reindex(session);
    } else if (!normCwd(session.cwd) && normCwd(cwd)) {
      session.cwd = cwd;
      if (info.name) session.name = info.name;
      this.reindex(session);
    }
    session._discovered = true;
    if (info.pid) session.live_pid = info.pid;
    return { created, skipped: false, session: this.publicSession(session) };
  }

  /**
   * Drop sessions whose process is gone, and hook sessions that went quiet
   * after the process exited. `liveTypes === null` means the scan failed —
   * don't reap on a guess.
   */
  reap({ livePids = null, liveTypes = null, now = Date.now() } = {}) {
    if (!liveTypes) return [];
    const removed = [];
    for (const session of [...this.sessions.values()]) {
      const age = now - new Date(session.last_event_at).getTime();
      const waiting =
        session.status === "waiting" ||
        session.pending_permission ||
        session.pending_question ||
        session.pending_plan;
      const typeAlive = liveTypes.has(session.agent_type);
      const pidDead =
        session.live_pid && livePids && !livePids.has(Number(session.live_pid));

      if (session.status === "disconnected") {
        removed.push(session.id);
        this.removeSession(session.id);
        continue;
      }

      if (!typeAlive && pidDead && (!waiting || age > 60 * 1000)) {
        removed.push(session.id);
        this.removeSession(session.id);
        continue;
      }

      if (!typeAlive && !waiting && session._discovered && !session._hooked) {
        removed.push(session.id);
        this.removeSession(session.id);
        continue;
      }

      if (!typeAlive && !waiting && age > 3 * 60 * 1000) {
        removed.push(session.id);
        this.removeSession(session.id);
      }
    }
    return removed;
  }

  handleEvent(rawPayload) {
    const payload = normalizeHookPayload(rawPayload);

    const eventName = payload.hook_event_name || "Unknown";
    const session = this.getOrCreateSession(payload);
    session._hooked = true;

    session.last_event_at = nowIso();
    if (payload.remote_host) session.remote_host = payload.remote_host;
    if (session.pending_plan === undefined) session.pending_plan = null;

    const agentType = inferAgentType(payload);
    let reindex = false;
    if (agentType && agentType !== "unknown" && session.agent_type !== agentType) {
      session.agent_type = agentType;
      reindex = true;
    }
    if (payload.cwd && normCwd(payload.cwd) !== normCwd(session.cwd)) {
      session.cwd = payload.cwd;
      const parts = payload.cwd.split(/[/\\]/).filter(Boolean);
      if (parts.length) session.name = parts[parts.length - 1];
      reindex = true;
    }
    if (reindex) this.reindex(session);
    this.dismissed.delete(displayKey(session.agent_type, session.cwd, session.remote_host));

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
        session.last_tool = payload.tool_name || "tool";
        session.pending_question = null;
        // The activity relay and the gated permission hook fire in parallel for
        // the same tool call. Whichever lands second must not erase the card the
        // other raised, so leave a live permission alone.
        if (!session.pending_permission) session.status = "thinking";
        this.cancelIdle(session.id); // actively working
        break;

      case "PostToolUse":
      case "PostToolUseFailure":
        session.status = "thinking";
        session.last_tool = payload.tool_name || session.last_tool;
        session.pending_question = null;
        // The tool finished, so a permission card for it is stale. A card for
        // a different tool (the next call already arrived) stays up.
        if (session.pending_permission) {
          const pendingTool = session.pending_permission.tool_name || "";
          const tool = payload.tool_name || "";
          if (!pendingTool || !tool || pendingTool === tool || pendingTool === "Permission") {
            session.pending_permission = null;
          }
        }
        this.scheduleIdle(session.id);
        break;

      case "AgentActivity":
        if (!session.pending_permission && !session.pending_question && !session.pending_plan) {
          session.status = "thinking";
          session.last_tool = payload.tool_name || session.last_tool || "responding";
          this.scheduleIdle(session.id);
        }
        break;

      case "PermissionRequest":
        this.cancelIdle(session.id);
        session.status = "waiting";
        session.pending_permission = {
          tool_name: payload.tool_name || "",
          tool_input: payload.tool_input || {},
          description: payload.message || describeToolInput(payload.tool_input),
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

      case "SessionEnd": {
        this.cancelIdle(session.id);
        session.status = "disconnected";
        session.pending_permission = null;
        session.pending_question = null;
        session.pending_plan = null;
        session.last_tool = null;
        const ended = this.publicSession(session);
        this.removeSession(session.id);
        return ended;
      }

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

    return this.publicSession(session);
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

    return Array.from(byKey.values())
      .map((s) => this.publicSession(s))
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
    for (const [key, id] of this.displayIndex) {
      if (id === sessionId) this.displayIndex.delete(key);
    }
    this.sessions.delete(sessionId);
    const waiter = this.permissionWaiters.get(sessionId);
    if (waiter) waiter.resolve("deny");
  }

  dismiss(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.dismissed.add(displayKey(session.agent_type, session.cwd, session.remote_host));
    }
    this.removeSession(sessionId);
  }

  dismissAll() {
    for (const session of this.sessions.values()) {
      this.dismissed.add(displayKey(session.agent_type, session.cwd, session.remote_host));
    }
    this.clearAll();
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
  isNoiseIdleMessage,
};
