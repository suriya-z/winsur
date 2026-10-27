//! Session manager — one card per agent terminal, idle/working lifecycle.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use chrono::{DateTime, SecondsFormat, Utc};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use uuid::Uuid;

const IDLE_AFTER: Duration = Duration::from_millis(6000);

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn parse_millis(iso: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(iso)
        .ok()
        .map(|d| d.timestamp_millis())
}

pub fn norm_cwd(cwd: &str) -> String {
    cwd.trim()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

pub fn display_key(agent_type: &str, cwd: &str, remote_host: Option<&str>) -> String {
    format!(
        "{}|{}|{}",
        if agent_type.is_empty() {
            "unknown"
        } else {
            agent_type
        },
        norm_cwd(cwd),
        remote_host.unwrap_or("")
    )
}

pub fn is_noise_idle_message(msg: &str, ntype: &str) -> bool {
    let t = ntype.to_lowercase().replace(['-', '_'], "");
    if matches!(
        t.as_str(),
        "idleprompt" | "idle" | "agentidle" | "turncomplete" | "complete"
    ) {
        return true;
    }
    let m = msg.to_lowercase();
    let m = m.trim();
    if m.is_empty() {
        return true;
    }
    if m.len() > 96 {
        return false;
    }
    const EXACT: &[&str] = &[
        "idle",
        "finished",
        "complete",
        "done",
        "task complete",
        "turn complete",
    ];
    if EXACT.contains(&m) {
        return true;
    }
    const PREFIXES: &[&str] = &[
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
    PREFIXES.iter().any(|n| {
        m == *n
            || m.starts_with(&format!("{n} "))
            || m.starts_with(&format!("{n}."))
            || m.starts_with(&format!("{n}…"))
    })
}

fn alias(ev: &str) -> Option<&'static str> {
    Some(match ev {
        "pre_tool_use"
        | "pre_tool_call"
        | "preToolUse"
        | "beforeShellExecution"
        | "beforeMCPExecution" => "PreToolUse",
        "post_tool_use"
        | "post_tool_call"
        | "postToolUse"
        | "afterShellExecution"
        | "afterFileEdit"
        | "afterMCPExecution" => "PostToolUse",
        "post_tool_use_failure" | "postToolUseFailure" => "PostToolUseFailure",
        "pre_llm_call" | "user_prompt_submit" | "beforeSubmitPrompt" => "UserPromptSubmit",
        "post_llm_call" => "PostToolUse",
        "on_session_start" | "session_start" | "sessionStart" | "workspaceOpen"
        | "workspace_open" => "SessionStart",
        "on_session_end" | "session_end" | "sessionEnd" => "SessionEnd",
        "on_session_finalize" | "on_stream_end" | "stop" => "Stop",
        "stop_failure" => "StopFailure",
        "notification" => "Notification",
        "subagent_start" | "subagentStart" => "SubagentStart",
        "subagent_stop" | "subagent_end" | "subagentStop" => "SubagentStop",
        "pre_compact" | "preCompact" => "PreCompact",
        "post_compact" => "PostCompact",
        "permission_denied" => "PermissionDenied",
        "afterAgentResponse" | "afterAgentThought" => "AgentActivity",
        _ => return None,
    })
}

fn as_str(v: &Value) -> Option<&str> {
    v.as_str()
}

fn set_if_null(obj: &mut Map<String, Value>, key: &str, value: Value) {
    let missing = obj.get(key).map(|v| v.is_null()).unwrap_or(true);
    if missing && !value.is_null() {
        obj.insert(key.to_string(), value);
    }
}

pub fn normalize_hook_payload(raw: &Value) -> Value {
    let Some(src) = raw.as_object() else {
        return json!({});
    };
    let mut p = src.clone();

    if let Some(v) = p.get("hookEventName").cloned() {
        set_if_null(&mut p, "hook_event_name", v);
    }
    if let Some(v) = p.get("sessionId").cloned() {
        set_if_null(&mut p, "session_id", v);
    }
    if let Some(v) = p.get("conversationId").cloned() {
        set_if_null(&mut p, "session_id", v);
    }
    if let Some(v) = p.get("conversation_id").cloned() {
        set_if_null(&mut p, "session_id", v);
    }
    if let Some(v) = p.get("toolName").cloned() {
        set_if_null(&mut p, "tool_name", v);
    }
    if let Some(name) = p.get("toolCall").and_then(|t| t.get("name")).cloned() {
        set_if_null(&mut p, "tool_name", name);
    }
    if let Some(v) = p.get("toolInput").cloned() {
        set_if_null(&mut p, "tool_input", v);
    }
    if let Some(args) = p.get("toolCall").and_then(|t| t.get("args")).cloned() {
        set_if_null(&mut p, "tool_input", args);
    }
    if let Some(v) = p.get("toolResponse").cloned() {
        set_if_null(&mut p, "tool_response", v);
    }
    if let Some(v) = p.get("transcriptPath").cloned() {
        set_if_null(&mut p, "transcript_path", v);
    }
    if let Some(v) = p.get("notificationType").cloned() {
        set_if_null(&mut p, "notification_type", v);
    }
    if let Some(v) = p.get("agentType").cloned() {
        set_if_null(&mut p, "agent_type", v);
    }
    if let Some(v) = p.get("permissionMode").cloned() {
        set_if_null(&mut p, "permission_mode", v);
    }
    let cwd_missing = p
        .get("cwd")
        .map(|v| v.is_null() || as_str(v).is_some_and(str::is_empty))
        .unwrap_or(true);
    if cwd_missing {
        if let Some(v) = p.get("workspaceRoot").cloned().filter(|v| !v.is_null()) {
            p.insert("cwd".into(), v);
        } else if let Some(v) = p.get("workspace_root").cloned().filter(|v| !v.is_null()) {
            p.insert("cwd".into(), v);
        } else if let Some(first) = p
            .get("workspacePaths")
            .and_then(|v| v.as_array())
            .and_then(|a| a.first())
            .cloned()
        {
            p.insert("cwd".into(), first);
        } else if let Some(first) = p
            .get("workspace_roots")
            .and_then(|v| v.as_array())
            .and_then(|a| a.first())
            .cloned()
        {
            p.insert("cwd".into(), first);
        }
    }
    if p.get("agent_type").map(|v| v.is_null()).unwrap_or(true)
        && p.get("cursor_version").is_some_and(|v| !v.is_null())
    {
        p.insert("agent_type".into(), json!("cursor"));
    }

    let ev = p
        .get("hook_event_name")
        .and_then(as_str)
        .or_else(|| p.get("hookEventName").and_then(as_str))
        .unwrap_or("Unknown");
    let ev = alias(ev).unwrap_or(ev).to_string();
    p.insert("hook_event_name".into(), json!(ev));
    Value::Object(p)
}

fn map_agent_type(at: &str) -> Option<&'static str> {
    Some(match at {
        "grok-build" | "grok" => "grok-build",
        "claude-code" | "claude" => "claude-code",
        "codex" | "codex-cli" => "codex",
        "cursor" => "cursor",
        "antigravity" => "antigravity",
        "claude-desktop" => "claude-desktop",
        "opencode" => "opencode",
        "qwen-code" | "qwen" => "qwen-code",
        "code-buddy" | "codebuddy" => "code-buddy",
        "windsurf" => "windsurf",
        "gemini" | "gemini-cli" => "gemini",
        "zcode" => "zcode",
        "trae" => "trae",
        "mimocode" => "mimocode",
        "droid" => "droid",
        "qoder" => "qoder",
        "kimi" => "kimi",
        "deepseek" => "deepseek",
        "mistral" => "mistral",
        "copilot" | "github-copilot" => "copilot",
        "workbuddy" => "workbuddy",
        "kiro" => "kiro",
        "hermes" => "hermes",
        "amp" => "amp",
        "pi-agent" | "pi" => "pi-agent",
        "oh-my-pi" => "oh-my-pi",
        "gajae" => "gajae",
        _ => return None,
    })
}

const TRANSCRIPT_MARKERS: &[(&str, &str)] = &[
    ("/.grok/", "grok-build"),
    ("/.claude/", "claude-code"),
    ("/.codex/", "codex"),
    ("/.cursor/", "cursor"),
    ("/.gemini/", "gemini"),
    ("/antigravity/", "antigravity"),
    ("/.opencode/", "opencode"),
    ("/.qwen/", "qwen-code"),
    ("/.codebuddy/", "code-buddy"),
    ("/.hermes/", "hermes"),
    ("/.kimi/", "kimi"),
    ("/.deepseek/", "deepseek"),
    ("/.mistral/", "mistral"),
    ("/.kiro/", "kiro"),
    ("/.windsurf/", "windsurf"),
];

fn marker_hit(value: &str) -> Option<&'static str> {
    let n = value.replace('\\', "/").to_lowercase();
    if n.is_empty() {
        return None;
    }
    let padded = if n.ends_with('/') { n } else { format!("{n}/") };
    TRANSCRIPT_MARKERS
        .iter()
        .find(|(needle, _)| padded.contains(needle))
        .map(|(_, id)| *id)
}

pub fn infer_agent_type(payload: &Value) -> String {
    let at = payload
        .get("agent_type")
        .and_then(as_str)
        .unwrap_or("")
        .to_lowercase()
        .replace('_', "-");
    if let Some(mapped) = map_agent_type(&at) {
        return mapped.to_string();
    }
    if payload.get("cursor_version").is_some_and(|v| !v.is_null()) {
        return "cursor".into();
    }
    if payload
        .get("workspace_roots")
        .and_then(|v| v.as_array())
        .is_some_and(|a| !a.is_empty())
    {
        return "cursor".into();
    }
    if payload.get("conversationId").is_some_and(|v| !v.is_null())
        || payload
            .get("artifactDirectoryPath")
            .is_some_and(|v| !v.is_null())
    {
        return "antigravity".into();
    }
    if payload.get("delivery_id").is_some_and(|v| !v.is_null())
        && payload.get("profile").is_some_and(|v| !v.is_null())
    {
        return "hermes".into();
    }
    if let Some(id) = payload
        .get("transcript_path")
        .and_then(as_str)
        .and_then(marker_hit)
    {
        return id.to_string();
    }
    let looks_grok = (payload.get("hookEventName").is_some_and(|v| !v.is_null())
        || payload.get("workspaceRoot").is_some_and(|v| !v.is_null()))
        && payload.get("sessionId").is_some_and(|v| !v.is_null())
        && payload
            .get("transcript_path")
            .map(|v| v.is_null())
            .unwrap_or(true)
        && payload
            .get("cursor_version")
            .map(|v| v.is_null())
            .unwrap_or(true)
        && payload
            .get("workspace_roots")
            .map(|v| v.is_null())
            .unwrap_or(true)
        && payload
            .get("conversation_id")
            .map(|v| v.is_null())
            .unwrap_or(true);
    if looks_grok {
        return "grok-build".into();
    }
    if payload.get("permission_mode").is_some_and(|v| !v.is_null())
        && payload
            .get("workspaceRoot")
            .map(|v| v.is_null())
            .unwrap_or(true)
        && payload
            .get("cursor_version")
            .map(|v| v.is_null())
            .unwrap_or(true)
        && payload
            .get("workspace_roots")
            .map(|v| v.is_null())
            .unwrap_or(true)
    {
        return "claude-code".into();
    }
    let model = payload
        .get("model")
        .and_then(as_str)
        .or_else(|| payload.get("modelName").and_then(as_str))
        .unwrap_or("")
        .to_lowercase();
    if payload
        .get("cursor_version")
        .map(|v| v.is_null())
        .unwrap_or(true)
        && payload
            .get("workspace_roots")
            .map(|v| v.is_null())
            .unwrap_or(true)
    {
        if model.contains("grok") {
            return "grok-build".into();
        }
        if model.contains("claude") {
            return "claude-code".into();
        }
        if model.contains("gpt") || model.contains("codex") {
            return "codex".into();
        }
        if model.contains("gemini") {
            return "gemini".into();
        }
        if model.contains("qwen") {
            return "qwen-code".into();
        }
    }
    "unknown".into()
}

fn describe_tool_input(tool_input: &Value) -> String {
    let Some(obj) = tool_input.as_object() else {
        return String::new();
    };
    for key in [
        "command",
        "file_path",
        "notebook_path",
        "path",
        "pattern",
        "url",
    ] {
        if let Some(v) = obj.get(key).filter(|v| !v.is_null()) {
            if let Some(s) = v.as_str() {
                if !s.is_empty() {
                    return s.to_string();
                }
            } else {
                return v.to_string();
            }
        }
    }
    serde_json::to_string(tool_input).unwrap_or_default()
}

fn str_field(v: &Value, key: &str) -> String {
    v.get(key).and_then(as_str).unwrap_or("").to_string()
}

fn folder_name(cwd: &str) -> String {
    cwd.split(['/', '\\'])
        .rfind(|p| !p.is_empty())
        .unwrap_or("")
        .to_string()
}

type IdleCallback = dyn Fn(Session) + Send + Sync;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct PendingPermission {
    pub tool_name: String,
    pub tool_input: Value,
    pub description: String,
    pub timestamp: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct PendingPlan {
    pub markdown: String,
    pub title: String,
    pub timestamp: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub agent_type: String,
    pub status: String,
    pub name: String,
    pub cwd: String,
    pub started_at: String,
    pub last_event_at: String,
    pub pending_permission: Option<PendingPermission>,
    pub pending_question: Option<String>,
    pub pending_plan: Option<PendingPlan>,
    pub last_tool: Option<String>,
    #[serde(default)]
    pub last_reply: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_host: Option<String>,
    #[serde(skip)]
    hooked: bool,
    #[serde(skip)]
    discovered: bool,
    #[serde(skip)]
    live_pid: Option<u32>,
}

#[derive(Clone, Debug)]
pub struct DiscoverInfo {
    pub id: String,
    pub agent_type: String,
    pub cwd: String,
    pub name: String,
    pub pid: Option<u32>,
    pub status: String,
    pub last_event_at: String,
}

#[derive(Clone, Debug)]
pub struct NoteResult {
    pub created: bool,
    pub skipped: bool,
    pub session: Option<Session>,
}

struct Waiter {
    tx: Sender<String>,
    generation: u64,
}

struct Inner {
    sessions: IndexMap<String, Session>,
    display_index: HashMap<String, String>,
    dismissed: HashSet<String>,
}

pub struct SessionManager {
    inner: Mutex<Inner>,
    waiters: Mutex<HashMap<String, Waiter>>,
    idle_cancel: Mutex<HashMap<String, Arc<AtomicBool>>>,
    waiter_gen: std::sync::atomic::AtomicU64,
    on_idle: Mutex<Option<Arc<IdleCallback>>>,
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                sessions: IndexMap::new(),
                display_index: HashMap::new(),
                dismissed: HashSet::new(),
            }),
            idle_cancel: Mutex::new(HashMap::new()),
            waiters: Mutex::new(HashMap::new()),
            waiter_gen: std::sync::atomic::AtomicU64::new(1),
            on_idle: Mutex::new(None),
        }
    }

    pub fn set_idle_callback(&self, cb: impl Fn(Session) + Send + Sync + 'static) {
        *self.on_idle.lock().expect("idle cb") = Some(Arc::new(cb));
    }

    fn reindex(inner: &mut Inner, session: &Session) {
        inner.display_index.retain(|_, id| id != &session.id);
        inner.display_index.insert(
            display_key(
                &session.agent_type,
                &session.cwd,
                session.remote_host.as_deref(),
            ),
            session.id.clone(),
        );
    }

    fn schedule_idle(self: &Arc<Self>, session_id: &str) {
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut timers = self.idle_cancel.lock().expect("idle");
            if let Some(prev) = timers.insert(session_id.to_string(), cancel.clone()) {
                prev.store(true, Ordering::SeqCst);
            }
        }
        let mgr = Arc::clone(self);
        let session_id = session_id.to_string();
        thread::spawn(move || {
            let start = Instant::now();
            while start.elapsed() < IDLE_AFTER {
                if cancel.load(Ordering::SeqCst) {
                    return;
                }
                thread::sleep(Duration::from_millis(50));
            }
            if cancel.load(Ordering::SeqCst) {
                return;
            }
            mgr.fire_idle(&session_id);
        });
    }

    fn cancel_idle(timers: &Mutex<HashMap<String, Arc<AtomicBool>>>, session_id: &str) {
        if let Some(flag) = timers.lock().expect("idle").remove(session_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }

    fn fire_idle(self: &Arc<Self>, session_id: &str) {
        let session = {
            Self::cancel_idle(&self.idle_cancel, session_id);
            let mut inner = self.inner.lock().expect("sessions");
            let Some(s) = inner.sessions.get_mut(session_id) else {
                return;
            };
            if s.status == "thinking"
                && s.pending_permission.is_none()
                && s.pending_question.is_none()
                && s.pending_plan.is_none()
            {
                s.status = "idle".into();
                s.last_tool = None;
                s.last_event_at = now_iso();
                s.clone()
            } else {
                return;
            }
        };
        if let Some(cb) = self.on_idle.lock().expect("idle cb").clone() {
            cb(session);
        }
    }

    fn get_or_create(inner: &mut Inner, payload: &Value) -> String {
        let agent_type = infer_agent_type(payload);
        let cwd = str_field(payload, "cwd");
        let remote = payload
            .get("remote_host")
            .and_then(as_str)
            .map(str::to_string)
            .filter(|s| !s.is_empty());
        let key = display_key(&agent_type, &cwd, remote.as_deref());
        let raw_id = str_field(payload, "session_id");

        if let Some(id) = inner.display_index.get(&key).cloned() {
            if let Some(session) = inner.sessions.get(&id) {
                if session.status != "disconnected" {
                    return id;
                }
            }
        }

        if !norm_cwd(&cwd).is_empty() && agent_type != "unknown" {
            let absorb = inner
                .sessions
                .values()
                .find(|session| {
                    session.agent_type == agent_type
                        && session.status != "disconnected"
                        && norm_cwd(&session.cwd).is_empty()
                })
                .map(|s| s.id.clone());
            if let Some(id) = absorb {
                if let Some(session) = inner.sessions.get_mut(&id) {
                    session.cwd = cwd.clone();
                    if remote.is_some() {
                        session.remote_host = remote;
                    }
                    let name = folder_name(&cwd);
                    if !name.is_empty() {
                        session.name = name;
                    }
                    let session = session.clone();
                    Self::reindex(inner, &session);
                    return id;
                }
            }
        }

        if !raw_id.is_empty() {
            if let Some(session) = inner.sessions.get_mut(&raw_id) {
                if session.status != "disconnected" {
                    if !cwd.is_empty() && norm_cwd(&session.cwd) != norm_cwd(&cwd) {
                        session.cwd = cwd.clone();
                        let name = folder_name(&cwd);
                        if !name.is_empty() {
                            session.name = name;
                        }
                    }
                    if agent_type != "unknown" {
                        session.agent_type = agent_type;
                    }
                    if remote.is_some() {
                        session.remote_host = remote;
                    }
                    let session = session.clone();
                    Self::reindex(inner, &session);
                    return raw_id;
                }
            }
        }

        let name = {
            let folder = folder_name(&cwd);
            if !folder.is_empty() {
                folder
            } else if agent_type != "unknown" {
                agent_type.clone()
            } else {
                "Agent".into()
            }
        };
        let id = if raw_id.is_empty() {
            Uuid::new_v4().to_string()
        } else {
            raw_id
        };
        let session = Session {
            id: id.clone(),
            agent_type,
            status: "idle".into(),
            name,
            cwd,
            started_at: now_iso(),
            last_event_at: now_iso(),
            pending_permission: None,
            pending_question: None,
            pending_plan: None,
            last_tool: None,
            last_reply: None,
            remote_host: remote,
            hooked: false,
            discovered: false,
            live_pid: None,
        };
        Self::reindex(inner, &session);
        inner.sessions.insert(id.clone(), session);
        id
    }

    pub fn note_discovered(&self, info: &DiscoverInfo) -> NoteResult {
        let mut inner = self.inner.lock().expect("sessions");
        let key = display_key(&info.agent_type, &info.cwd, None);
        if inner.dismissed.contains(&key) {
            return NoteResult {
                created: false,
                skipped: true,
                session: None,
            };
        }
        let existed = inner
            .display_index
            .get(&key)
            .and_then(|id| inner.sessions.get(id))
            .is_some();
        let payload = json!({
            "agent_type": info.agent_type,
            "cwd": info.cwd,
            "session_id": info.id,
        });
        let id = Self::get_or_create(&mut inner, &payload);
        let created = !existed;
        if let Some(session) = inner.sessions.get_mut(&id) {
            if created && !session.hooked {
                session.status = if info.status.is_empty() {
                    "idle".into()
                } else {
                    info.status.clone()
                };
                if !info.name.is_empty() {
                    session.name = info.name.clone();
                }
                session.cwd = info.cwd.clone();
                if !info.last_event_at.is_empty() {
                    session.last_event_at = info.last_event_at.clone();
                    session.started_at = info.last_event_at.clone();
                }
            } else if norm_cwd(&session.cwd).is_empty() && !norm_cwd(&info.cwd).is_empty() {
                session.cwd = info.cwd.clone();
                if !info.name.is_empty() {
                    session.name = info.name.clone();
                }
            }
            session.discovered = true;
            if info.pid.is_some() {
                session.live_pid = info.pid;
            }
            let session = session.clone();
            Self::reindex(&mut inner, &session);
            return NoteResult {
                created,
                skipped: false,
                session: Some(session),
            };
        }
        NoteResult {
            created,
            skipped: false,
            session: None,
        }
    }

    pub fn reap(
        &self,
        live_pids: Option<&HashSet<u32>>,
        live_types: Option<&HashSet<String>>,
        now_ms: i64,
    ) -> Vec<String> {
        let Some(live_types) = live_types else {
            return Vec::new();
        };
        let mut inner = self.inner.lock().expect("sessions");
        let snapshot: Vec<Session> = inner.sessions.values().cloned().collect();
        let mut removed = Vec::new();
        for session in snapshot {
            let age = parse_millis(&session.last_event_at).map(|t| now_ms - t);
            let older = |ms: i64| age.is_some_and(|a| a > ms);
            let waiting = session.status == "waiting"
                || session.pending_permission.is_some()
                || session.pending_question.is_some()
                || session.pending_plan.is_some();
            let type_alive = live_types.contains(&session.agent_type);
            let pid_dead = session
                .live_pid
                .is_some_and(|pid| live_pids.is_some_and(|set| !set.contains(&pid)));

            let drop_it = session.status == "disconnected"
                || (!type_alive && pid_dead && (!waiting || older(60_000)))
                || (!type_alive && !waiting && session.discovered && !session.hooked)
                || (!type_alive && !waiting && older(3 * 60 * 1000));
            if drop_it {
                removed.push(session.id.clone());
                Self::remove_locked(&self.idle_cancel, &mut inner, &session.id);
                self.deny_waiter(&session.id);
            }
        }
        removed
    }

    pub fn handle_event(self: &Arc<Self>, raw: &Value) -> Option<Session> {
        let payload = normalize_hook_payload(raw);
        let event_name = str_field(&payload, "hook_event_name");
        let event_name = if event_name.is_empty() {
            "Unknown".into()
        } else {
            event_name
        };

        let mut inner = self.inner.lock().expect("sessions");
        let id = Self::get_or_create(&mut inner, &payload);
        let session = inner.sessions.get_mut(&id)?;
        session.hooked = true;
        session.last_event_at = now_iso();
        if let Some(remote) = payload
            .get("remote_host")
            .and_then(as_str)
            .filter(|s| !s.is_empty())
        {
            session.remote_host = Some(remote.to_string());
        }

        let agent_type = infer_agent_type(&payload);
        let mut reindex = false;
        if !agent_type.is_empty() && agent_type != "unknown" && session.agent_type != agent_type {
            session.agent_type = agent_type;
            reindex = true;
        }
        let cwd = str_field(&payload, "cwd");
        if !cwd.is_empty() && norm_cwd(&cwd) != norm_cwd(&session.cwd) {
            session.cwd = cwd.clone();
            let name = folder_name(&cwd);
            if !name.is_empty() {
                session.name = name;
            }
            reindex = true;
        }
        if reindex {
            let session = session.clone();
            Self::reindex(&mut inner, &session);
        }
        let key = {
            let session = inner.sessions.get(&id)?;
            display_key(
                &session.agent_type,
                &session.cwd,
                session.remote_host.as_deref(),
            )
        };
        inner.dismissed.remove(&key);
        let session = inner.sessions.get_mut(&id)?;

        let tool_name = str_field(&payload, "tool_name");
        if let Some(reply) = capture_assistant_reply(&event_name, &payload) {
            session.last_reply = Some(reply);
        }
        match event_name.as_str() {
            "SessionStart" => {
                session.status = "idle".into();
                session.last_tool = None;
                Self::cancel_idle(&self.idle_cancel, &id);
            }
            "UserPromptSubmit" => {
                session.status = "thinking".into();
                session.last_tool = Some("prompt".into());
                session.pending_question = None;
                let sid = id.clone();
                drop(inner);
                self.schedule_idle(&sid);
                return self.session_by_id(&sid);
            }
            "PreToolUse" => {
                session.last_tool = Some(if tool_name.is_empty() {
                    "tool".into()
                } else {
                    tool_name
                });
                session.pending_question = None;
                if session.pending_permission.is_none() {
                    session.status = "thinking".into();
                }
                Self::cancel_idle(&self.idle_cancel, &id);
            }
            "PostToolUse" | "PostToolUseFailure" => {
                session.status = "thinking".into();
                if !tool_name.is_empty() {
                    session.last_tool = Some(tool_name.clone());
                }
                session.pending_question = None;
                if let Some(pending) = &session.pending_permission {
                    let pending_tool = pending.tool_name.clone();
                    if pending_tool.is_empty()
                        || tool_name.is_empty()
                        || pending_tool == tool_name
                        || pending_tool == "Permission"
                    {
                        session.pending_permission = None;
                    }
                }
                let sid = id.clone();
                drop(inner);
                self.schedule_idle(&sid);
                return self.session_by_id(&sid);
            }
            "AgentActivity" => {
                if session.pending_permission.is_none()
                    && session.pending_question.is_none()
                    && session.pending_plan.is_none()
                {
                    session.status = "thinking".into();
                    if !tool_name.is_empty() {
                        session.last_tool = Some(tool_name);
                    } else if session.last_tool.is_none() {
                        session.last_tool = Some("responding".into());
                    }
                    let sid = id.clone();
                    drop(inner);
                    self.schedule_idle(&sid);
                    return self.session_by_id(&sid);
                }
            }
            "PermissionRequest" => {
                Self::cancel_idle(&self.idle_cancel, &id);
                session.status = "waiting".into();
                let message = str_field(&payload, "message");
                let tool_input = payload.get("tool_input").cloned().unwrap_or(json!({}));
                session.pending_permission = Some(PendingPermission {
                    tool_name: tool_name.clone(),
                    description: if message.is_empty() {
                        describe_tool_input(&tool_input)
                    } else {
                        message
                    },
                    tool_input,
                    timestamp: now_iso(),
                });
            }
            "Notification" => {
                let ntype = str_field(&payload, "notification_type");
                let msg = {
                    let m = str_field(&payload, "message");
                    if m.is_empty() {
                        str_field(&payload, "title")
                    } else {
                        m
                    }
                };
                let ntype_norm = ntype.to_lowercase();
                if ntype_norm == "permission_prompt" || ntype_norm == "permission" {
                    Self::cancel_idle(&self.idle_cancel, &id);
                    session.status = "waiting".into();
                    let title = str_field(&payload, "title");
                    session.pending_permission = Some(PendingPermission {
                        tool_name: if title.is_empty() {
                            "Permission".into()
                        } else {
                            title
                        },
                        tool_input: json!({}),
                        description: msg,
                        timestamp: now_iso(),
                    });
                } else if is_noise_idle_message(&msg, &ntype) || ntype_norm.contains("idle") {
                    Self::cancel_idle(&self.idle_cancel, &id);
                    session.status = "idle".into();
                    session.pending_question = None;
                    session.last_tool = None;
                } else if matches!(
                    ntype_norm.as_str(),
                    "elicitation_dialog" | "elicitation" | "ask_user"
                ) {
                    if !is_noise_idle_message(&msg, &ntype) {
                        Self::cancel_idle(&self.idle_cancel, &id);
                        session.status = "waiting".into();
                        session.pending_question = Some(if msg.is_empty() {
                            "Agent needs a response".into()
                        } else {
                            msg
                        });
                    } else {
                        session.status = "idle".into();
                        session.pending_question = None;
                        session.last_tool = None;
                    }
                }
            }
            "Question" | "AskUser" => {
                let msg = str_field(&payload, "message");
                if is_noise_idle_message(&msg, "question") {
                    session.status = "idle".into();
                    session.pending_question = None;
                    session.last_tool = None;
                } else {
                    Self::cancel_idle(&self.idle_cancel, &id);
                    session.status = "waiting".into();
                    session.pending_question = Some(if msg.is_empty() {
                        "Agent needs a response".into()
                    } else {
                        msg
                    });
                }
            }
            "SubagentStart" => {
                session.status = "thinking".into();
                session.last_tool = Some("subagent".into());
                Self::cancel_idle(&self.idle_cancel, &id);
            }
            "SubagentStop" => {
                session.status = "thinking".into();
                session.last_tool = Some("subagent done".into());
                let sid = id.clone();
                drop(inner);
                self.schedule_idle(&sid);
                return self.session_by_id(&sid);
            }
            "Stop" | "StopFailure" => {
                Self::cancel_idle(&self.idle_cancel, &id);
                session.status = "idle".into();
                session.pending_permission = None;
                session.pending_question = None;
                session.last_tool = None;
            }
            "SessionEnd" => {
                Self::cancel_idle(&self.idle_cancel, &id);
                session.status = "disconnected".into();
                session.pending_permission = None;
                session.pending_question = None;
                session.pending_plan = None;
                session.last_tool = None;
                let ended = session.clone();
                Self::remove_locked(&self.idle_cancel, &mut inner, &id);
                drop(inner);
                self.deny_waiter(&id);
                return Some(ended);
            }
            "Plan" | "ExitPlanMode" | "plan_submit" | "PlanSubmit" | "ShowPlan" => {
                let plan_text = plan_text(&payload);
                if plan_text.trim().len() > 8 {
                    Self::cancel_idle(&self.idle_cancel, &id);
                    session.status = "waiting".into();
                    let title = str_field(&payload, "title");
                    session.pending_plan = Some(PendingPlan {
                        markdown: plan_text,
                        title: if title.is_empty() {
                            "Plan review".into()
                        } else {
                            title
                        },
                        timestamp: now_iso(),
                    });
                }
            }
            _ => {
                let tool = tool_name.to_lowercase();
                if (tool.contains("plan") || tool == "exitplanmode")
                    && (payload.get("tool_input").is_some() || payload.get("message").is_some())
                {
                    let plan_text = payload
                        .get("tool_input")
                        .and_then(|v| v.get("plan"))
                        .and_then(as_str)
                        .map(str::to_string)
                        .filter(|s| !s.is_empty())
                        .or_else(|| {
                            let m = str_field(&payload, "message");
                            if m.is_empty() {
                                None
                            } else {
                                Some(m)
                            }
                        })
                        .unwrap_or_else(|| {
                            serde_json::to_string_pretty(
                                payload.get("tool_input").unwrap_or(&json!({})),
                            )
                            .unwrap_or_default()
                        });
                    if plan_text.len() > 40 {
                        Self::cancel_idle(&self.idle_cancel, &id);
                        session.status = "waiting".into();
                        session.pending_plan = Some(PendingPlan {
                            markdown: plan_text,
                            title: if tool_name.is_empty() {
                                "Plan".into()
                            } else {
                                tool_name
                            },
                            timestamp: now_iso(),
                        });
                    }
                }
            }
        }
        inner.sessions.get(&id).cloned()
    }

    fn session_by_id(&self, id: &str) -> Option<Session> {
        self.inner
            .lock()
            .expect("sessions")
            .sessions
            .get(id)
            .cloned()
    }

    pub fn get_sessions(&self) -> Vec<Session> {
        let inner = self.inner.lock().expect("sessions");
        let mut by_key: IndexMap<String, Session> = IndexMap::new();
        for s in inner.sessions.values() {
            if s.status == "disconnected" {
                continue;
            }
            let key = display_key(&s.agent_type, &s.cwd, s.remote_host.as_deref());
            let replace = by_key.get(&key).is_none_or(|prev| {
                parse_millis(&s.last_event_at).unwrap_or(0)
                    > parse_millis(&prev.last_event_at).unwrap_or(0)
            });
            if replace {
                by_key.insert(key, s.clone());
            }
        }
        let mut list: Vec<Session> = by_key.into_values().collect();
        list.sort_by_key(|session| {
            std::cmp::Reverse(parse_millis(&session.last_event_at).unwrap_or(0))
        });
        list
    }

    pub fn respond_permission_arc(self: &Arc<Self>, session_id: &str, decision: &str) -> bool {
        let exists = {
            let mut inner = self.inner.lock().expect("sessions");
            if let Some(session) = inner.sessions.get_mut(session_id) {
                session.pending_permission = None;
                session.status = "thinking".into();
                true
            } else {
                false
            }
        };
        if exists {
            self.schedule_idle(session_id);
        }
        let mut waiters = self.waiters.lock().expect("waiters");
        if let Some(w) = waiters.remove(session_id) {
            let _ = w.tx.send(decision.to_string());
            true
        } else {
            false
        }
    }

    pub fn wait_permission(self: &Arc<Self>, session_id: &str, timeout: Duration) -> String {
        let (tx, rx): (Sender<String>, Receiver<String>) = mpsc::channel();
        let generation = self.waiter_gen.fetch_add(1, Ordering::SeqCst);
        {
            let mut map = self.waiters.lock().expect("waiters");
            if let Some(old) = map.insert(session_id.to_string(), Waiter { tx, generation }) {
                let _ = old.tx.send("deny".into());
            }
        }
        match rx.recv_timeout(timeout) {
            Ok(decision) => decision,
            Err(_) => {
                let still = {
                    let mut map = self.waiters.lock().expect("waiters");
                    if map
                        .get(session_id)
                        .is_some_and(|w| w.generation == generation)
                    {
                        map.remove(session_id);
                        true
                    } else {
                        false
                    }
                };
                if still {
                    self.respond_permission_arc(session_id, "deny");
                }
                "deny".into()
            }
        }
    }

    fn deny_waiter(&self, session_id: &str) {
        if let Some(w) = self.waiters.lock().expect("waiters").remove(session_id) {
            let _ = w.tx.send("deny".into());
        }
    }

    pub fn clear_question(self: &Arc<Self>, session_id: &str) {
        let schedule = {
            let mut inner = self.inner.lock().expect("sessions");
            let Some(session) = inner.sessions.get_mut(session_id) else {
                return;
            };
            session.pending_question = None;
            session.status == "waiting"
                && session.pending_plan.is_none()
                && session.pending_permission.is_none()
        };
        if schedule {
            {
                let mut inner = self.inner.lock().expect("sessions");
                if let Some(session) = inner.sessions.get_mut(session_id) {
                    session.status = "thinking".into();
                }
            }
            self.schedule_idle(session_id);
        }
    }

    pub fn clear_plan(self: &Arc<Self>, session_id: &str) {
        let schedule = {
            let mut inner = self.inner.lock().expect("sessions");
            let Some(session) = inner.sessions.get_mut(session_id) else {
                return;
            };
            session.pending_plan = None;
            session.status == "waiting"
                && session.pending_question.is_none()
                && session.pending_permission.is_none()
        };
        if schedule {
            {
                let mut inner = self.inner.lock().expect("sessions");
                if let Some(session) = inner.sessions.get_mut(session_id) {
                    session.status = "thinking".into();
                }
            }
            self.schedule_idle(session_id);
        }
    }

    pub fn mark_reply_sent(self: &Arc<Self>, session_id: &str) {
        self.clear_question(session_id);
        {
            let mut inner = self.inner.lock().expect("sessions");
            if let Some(session) = inner.sessions.get_mut(session_id) {
                session.status = "thinking".into();
                session.last_tool = Some("reply sent".into());
                session.pending_question = None;
            }
        }
        self.schedule_idle(session_id);
    }

    fn remove_locked(
        timers: &Mutex<HashMap<String, Arc<AtomicBool>>>,
        inner: &mut Inner,
        session_id: &str,
    ) {
        Self::cancel_idle(timers, session_id);
        inner.display_index.retain(|_, id| id != session_id);
        inner.sessions.shift_remove(session_id);
    }

    pub fn remove_session(&self, session_id: &str) {
        {
            let mut inner = self.inner.lock().expect("sessions");
            Self::remove_locked(&self.idle_cancel, &mut inner, session_id);
        }
        self.deny_waiter(session_id);
    }

    pub fn dismiss(&self, session_id: &str) {
        {
            let mut inner = self.inner.lock().expect("sessions");
            if let Some(session) = inner.sessions.get(session_id) {
                let key = display_key(
                    &session.agent_type,
                    &session.cwd,
                    session.remote_host.as_deref(),
                );
                inner.dismissed.insert(key);
            }
            Self::remove_locked(&self.idle_cancel, &mut inner, session_id);
        }
        self.deny_waiter(session_id);
    }

    pub fn dismiss_all(&self) {
        let ids: Vec<String> = {
            let mut inner = self.inner.lock().expect("sessions");
            let keys: Vec<String> = inner
                .sessions
                .values()
                .map(|session| {
                    display_key(
                        &session.agent_type,
                        &session.cwd,
                        session.remote_host.as_deref(),
                    )
                })
                .collect();
            for key in keys {
                inner.dismissed.insert(key);
            }
            inner.sessions.keys().cloned().collect()
        };
        self.clear_all();
        let _ = ids;
    }

    /// Drops every session. Does not clear the dismissed set.
    pub fn clear_all(&self) {
        let mut inner = self.inner.lock().expect("sessions");
        let ids: Vec<String> = inner.sessions.keys().cloned().collect();
        for id in &ids {
            Self::cancel_idle(&self.idle_cancel, id);
        }
        inner.sessions.clear();
        inner.display_index.clear();
        drop(inner);
        let mut waiters = self.waiters.lock().expect("waiters");
        for (_, w) in waiters.drain() {
            let _ = w.tx.send("deny".into());
        }
    }
}

fn limit_reply(text: &str) -> String {
    const MAX: usize = 4000;
    let trimmed = text.trim();
    if trimmed.chars().count() <= MAX {
        return trimmed.to_string();
    }
    let end = trimmed
        .char_indices()
        .nth(MAX)
        .map(|(idx, _)| idx)
        .unwrap_or(trimmed.len());
    format!("{}…", &trimmed[..end])
}

fn reply_leaf(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(limit_reply(trimmed))
            }
        }
        Value::Array(items) => {
            let parts: Vec<String> = items.iter().filter_map(reply_leaf).collect();
            if parts.is_empty() {
                None
            } else {
                Some(limit_reply(&parts.join("\n")))
            }
        }
        Value::Object(map) => {
            for key in ["text", "content", "message", "response"] {
                if let Some(child) = map.get(key) {
                    if let Some(text) = reply_leaf(child) {
                        return Some(text);
                    }
                }
            }
            None
        }
        _ => None,
    }
}

fn reply_from_fields(payload: &Value) -> Option<String> {
    for key in [
        "last_assistant_message",
        "lastAssistantMessage",
        "assistant_message",
        "assistantMessage",
        "final_response",
        "finalResponse",
        "response",
    ] {
        if let Some(value) = payload.get(key) {
            if let Some(text) = reply_leaf(value) {
                return Some(text);
            }
        }
    }
    None
}

fn transcript_is_assistant(value: &Value) -> bool {
    let kind = value.get("type").and_then(as_str).unwrap_or("");
    let role = value
        .get("role")
        .and_then(as_str)
        .or_else(|| {
            value
                .get("message")
                .and_then(|message| message.get("role"))
                .and_then(as_str)
        })
        .unwrap_or("");
    kind == "assistant" || role == "assistant"
}

fn reply_from_transcript(payload: &Value) -> Option<String> {
    let path = str_field(payload, "transcript_path");
    if path.is_empty() {
        return None;
    }
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let start = len.saturating_sub(128 * 1024);
    use std::io::{Read, Seek, SeekFrom};
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = String::new();
    file.read_to_string(&mut buf).ok()?;
    let mut latest = None;
    for line in buf.lines() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if !transcript_is_assistant(&value) {
            continue;
        }
        let body = value.get("message").unwrap_or(&value);
        if let Some(text) = reply_leaf(body.get("content").unwrap_or(body)) {
            latest = Some(text);
        }
    }
    latest
}

fn capture_assistant_reply(event_name: &str, payload: &Value) -> Option<String> {
    if let Some(text) = reply_from_fields(payload) {
        return Some(text);
    }
    if matches!(event_name, "Stop" | "StopFailure") {
        return reply_from_transcript(payload);
    }
    None
}

fn plan_text(payload: &Value) -> String {
    if let Some(s) = payload.get("plan").and_then(as_str) {
        if !s.is_empty() {
            return s.to_string();
        }
    }
    let message = str_field(payload, "message");
    if !message.is_empty() {
        return message;
    }
    if let Some(s) = payload
        .get("tool_input")
        .and_then(|v| v.get("plan"))
        .and_then(as_str)
    {
        return s.to_string();
    }
    if let Some(s) = payload
        .get("toolInput")
        .and_then(|v| v.get("plan"))
        .and_then(as_str)
    {
        return s.to_string();
    }
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mgr() -> Arc<SessionManager> {
        Arc::new(SessionManager::new())
    }

    #[test]
    fn infer_agent_type_does_not_call_cursor_or_a_claude_named_folder_grok() {
        let cursor = normalize_hook_payload(&json!({
            "hook_event_name": "sessionStart",
            "conversation_id": "conv-1",
            "cursor_version": "1.7.2",
            "workspace_roots": ["C:\\work\\app"],
            "sessionId": "should-not-matter"
        }));
        assert_eq!(infer_agent_type(&cursor), "cursor");
        assert_eq!(
            infer_agent_type(&json!({
                "cwd": "C:\\work\\claude-utils",
                "session_id": "abc",
                "hook_event_name": "PreToolUse"
            })),
            "unknown"
        );
        assert_eq!(
            infer_agent_type(&json!({
                "transcript_path": "C:\\Users\\me\\.claude\\projects\\foo\\s.jsonl",
                "cwd": "C:\\work\\app",
                "session_id": "s"
            })),
            "claude-code"
        );
        assert_eq!(
            infer_agent_type(&json!({
                "hookEventName": "PreToolUse",
                "sessionId": "g1",
                "workspaceRoot": "C:\\work\\app",
                "toolName": "bash"
            })),
            "grok-build"
        );
        assert_eq!(
            infer_agent_type(
                &json!({ "agent_type": "codex", "sessionId": "x", "workspaceRoot": "C:\\work" })
            ),
            "codex"
        );
        let norm = normalize_hook_payload(
            &json!({ "workspace_roots": ["D:\\proj"], "conversation_id": "c" }),
        );
        assert_eq!(norm["cwd"], "D:\\proj");
        assert_eq!(norm["session_id"], "c");
    }

    #[test]
    fn long_questions_are_not_treated_as_idle_noise() {
        assert!(is_noise_idle_message("idle", "notification"));
        assert!(is_noise_idle_message("finished", ""));
        assert!(!is_noise_idle_message(
            "I finished the migration — should I delete the old table?",
            "question"
        ));
    }

    #[test]
    fn sessions_merge_by_folder_end_for_real_and_do_not_stick_on_a_finished_tool() {
        let mgr = mgr();
        let discovered = mgr.note_discovered(&DiscoverInfo {
            id: "live:claude-code:".into(),
            agent_type: "claude-code".into(),
            cwd: String::new(),
            name: "Claude".into(),
            pid: Some(42),
            status: "idle".into(),
            last_event_at: now_iso(),
        });
        assert!(discovered.created);
        let hooked = mgr
            .handle_event(&json!({
                "hook_event_name": "PreToolUse",
                "agent_type": "claude-code",
                "session_id": "uuid-1",
                "cwd": "C:\\work\\app",
                "tool_name": "Bash",
                "transcript_path": "C:\\Users\\me\\.claude\\projects\\app\\s.jsonl"
            }))
            .unwrap();
        assert_eq!(hooked.id, discovered.session.unwrap().id);
        assert_eq!(hooked.cwd, "C:\\work\\app");
        assert_eq!(mgr.get_sessions().len(), 1);

        let other = mgr
            .handle_event(&json!({
                "hook_event_name": "SessionStart",
                "agent_type": "claude-code",
                "session_id": "uuid-2",
                "cwd": "C:\\work\\other",
                "transcript_path": "C:\\Users\\me\\.claude\\projects\\other\\s.jsonl"
            }))
            .unwrap();
        assert_ne!(other.id, hooked.id);
        assert_eq!(mgr.get_sessions().len(), 2);

        mgr.handle_event(&json!({
            "hook_event_name": "PermissionRequest",
            "agent_type": "claude-code",
            "session_id": "uuid-1",
            "cwd": "C:\\work\\app",
            "tool_name": "Bash",
            "tool_input": { "command": "rm -rf ./tmp" }
        }));
        assert!(mgr
            .get_sessions()
            .iter()
            .find(|s| s.cwd.ends_with("app"))
            .unwrap()
            .pending_permission
            .is_some());

        mgr.handle_event(&json!({
            "hook_event_name": "PostToolUse",
            "agent_type": "claude-code",
            "session_id": "uuid-1",
            "cwd": "C:\\work\\app",
            "tool_name": "Bash"
        }));
        assert!(mgr
            .get_sessions()
            .iter()
            .find(|s| s.cwd.ends_with("app"))
            .unwrap()
            .pending_permission
            .is_none());

        let ended = mgr
            .handle_event(&json!({
                "hook_event_name": "SessionEnd",
                "agent_type": "claude-code",
                "session_id": "uuid-2",
                "cwd": "C:\\work\\other"
            }))
            .unwrap();
        assert_eq!(ended.status, "disconnected");
        assert!(!mgr.get_sessions().iter().any(|s| s.cwd.ends_with("other")));

        let cursor = mgr
            .handle_event(&json!({
                "hook_event_name": "postToolUse",
                "cursor_version": "1.7.2",
                "conversation_id": "conv",
                "workspace_roots": ["C:\\work\\app"],
                "tool_name": "Shell",
                "sessionId": "not-grok"
            }))
            .unwrap();
        assert_eq!(cursor.agent_type, "cursor");

        let replied = mgr
            .handle_event(&json!({
                "hook_event_name": "Stop",
                "agent_type": "hermes",
                "session_id": "hermes-1",
                "cwd": "C:\\work\\hermes",
                "last_assistant_message": "The build finished.\nAll tests passed."
            }))
            .unwrap();
        assert_eq!(
            replied.last_reply.as_deref(),
            Some("The build finished.\nAll tests passed.")
        );
        let still = mgr
            .handle_event(&json!({
                "hook_event_name": "PreToolUse",
                "agent_type": "hermes",
                "session_id": "hermes-1",
                "cwd": "C:\\work\\hermes",
                "tool_name": "read"
            }))
            .unwrap();
        assert_eq!(
            still.last_reply.as_deref(),
            Some("The build finished.\nAll tests passed.")
        );

        let dir = std::env::temp_dir().join(format!("winsur-transcript-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("session.jsonl");
        std::fs::write(
            &path,
            concat!(
                "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"hi\"}}\n",
                "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"First\"}]}}\n",
                "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"Latest reply\"}]}}\n",
            ),
        )
        .unwrap();
        let from_file = mgr
            .handle_event(&json!({
                "hook_event_name": "Stop",
                "agent_type": "claude-code",
                "session_id": "claude-transcript",
                "cwd": "C:\\work\\transcript",
                "transcript_path": path.display().to_string()
            }))
            .unwrap();
        assert_eq!(from_file.last_reply.as_deref(), Some("Latest reply"));
        let _ = std::fs::remove_dir_all(dir);
        assert_eq!(cursor.cwd, "C:\\work\\app");
        assert!(mgr.get_sessions().iter().any(|s| s.agent_type == "cursor"));
        assert!(mgr
            .get_sessions()
            .iter()
            .any(|s| s.agent_type == "claude-code"));
    }

    #[test]
    fn reap_removes_a_discovered_agent_after_its_process_exits_and_respects_dismiss() {
        let mgr = mgr();
        mgr.note_discovered(&DiscoverInfo {
            id: "live:cursor:c:\\work\\app".into(),
            agent_type: "cursor".into(),
            cwd: "C:\\work\\app".into(),
            name: "app".into(),
            pid: Some(7),
            status: "idle".into(),
            last_event_at: now_iso(),
        });
        assert_eq!(mgr.get_sessions().len(), 1);
        let removed = mgr.reap(
            Some(&HashSet::new()),
            Some(&HashSet::new()),
            Utc::now().timestamp_millis(),
        );
        assert_eq!(removed.len(), 1);
        assert_eq!(mgr.get_sessions().len(), 0);

        mgr.note_discovered(&DiscoverInfo {
            id: "live:codex:".into(),
            agent_type: "codex".into(),
            cwd: String::new(),
            name: "Codex".into(),
            pid: Some(9),
            status: "idle".into(),
            last_event_at: now_iso(),
        });
        let codex = mgr.get_sessions().into_iter().next().unwrap();
        mgr.dismiss(&codex.id);
        let again = mgr.note_discovered(&DiscoverInfo {
            id: "live:codex:".into(),
            agent_type: "codex".into(),
            cwd: String::new(),
            name: "Codex".into(),
            pid: Some(9),
            status: "idle".into(),
            last_event_at: now_iso(),
        });
        assert!(again.skipped);
        assert_eq!(mgr.get_sessions().len(), 0);
        mgr.handle_event(&json!({
            "hook_event_name": "SessionStart",
            "agent_type": "codex",
            "session_id": "codex-1",
            "cwd": "C:\\work\\codex"
        }));
        assert_eq!(mgr.get_sessions().len(), 1);
    }

    #[test]
    fn failed_process_scans_do_not_reap_live_sessions() {
        let mgr = mgr();
        mgr.handle_event(&json!({
            "hook_event_name": "UserPromptSubmit",
            "agent_type": "grok-build",
            "session_id": "g",
            "cwd": "C:\\work\\g",
            "hookEventName": "UserPromptSubmit",
            "sessionId": "g",
            "workspaceRoot": "C:\\work\\g"
        }));
        assert!(mgr
            .reap(None, None, Utc::now().timestamp_millis())
            .is_empty());
        assert_eq!(mgr.get_sessions().len(), 1);
    }
}
