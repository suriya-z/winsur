// Agent 会话管理模块
// 功能：管理所有 AI Agent 的会话状态，处理 Hook 事件

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::oneshot;

/// Agent 类型枚举
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum AgentType {
    ClaudeCode,
    Codex,
    Cursor,
    Antigravity,
    ClaudeDesktop,
    Opencode,
    QwenCode,
    CodeBuddy,
    Windsurf,
    Unknown,
}

impl AgentType {
    /// 从 Hook 事件推断 Agent 类型
    ///
    /// 识别策略：
    /// 1. payload 中显式指定的 agent_type 字段
    /// 2. transcript_path 路径推断
    /// 3. cwd 路径推断
    /// 4. 其他线索字段
    pub fn from_hook_event(payload: &serde_json::Value) -> Self {
        // 1. 优先用 transcript_path 推断（最可靠，Claude Code 每个事件都带）
        if let Some(path) = payload.get("transcript_path").and_then(|v| v.as_str()) {
            let p = path.to_lowercase();
            if p.contains(".claude") || p.contains("claude") {
                return AgentType::ClaudeCode;
            } else if p.contains(".codex") || p.contains("codex") {
                return AgentType::Codex;
            } else if p.contains(".cursor") {
                return AgentType::Cursor;
            } else if p.contains("antigravity") {
                return AgentType::Antigravity;
            } else if p.contains("opencode") {
                return AgentType::Opencode;
            } else if p.contains("qwen") {
                return AgentType::QwenCode;
            } else if p.contains("codebuddy") {
                return AgentType::CodeBuddy;
            } else if p.contains("windsurf") {
                return AgentType::Windsurf;
            }
        }

        // 2. 检查 hook_event_name + permission_mode（只有 Claude Code 发这个字段）
        if payload.get("permission_mode").is_some() {
            return AgentType::ClaudeCode;
        }

        // 3. 检查 agent_type 字段
        //    Claude Code 子 Agent 的 agent_type 是 "Explore"/"Plan" 等，但 transcript_path 包含 .claude
        //    所以到这一步说明 transcript_path 没匹配，用显式映射
        if let Some(at) = payload.get("agent_type").and_then(|v| v.as_str()) {
            match at {
                "claude-code" | "claude_code" => return AgentType::ClaudeCode,
                "codex" => return AgentType::Codex,
                "cursor" => return AgentType::Cursor,
                "antigravity" => return AgentType::Antigravity,
                "claude-desktop" | "claude_desktop" => return AgentType::ClaudeDesktop,
                "opencode" => return AgentType::Opencode,
                "qwen-code" | "qwen_code" | "qwen" => return AgentType::QwenCode,
                "codebuddy" | "code_buddy" => return AgentType::CodeBuddy,
                "windsurf" => return AgentType::Windsurf,
                // Claude Code 子 Agent 类型名，统一归为 ClaudeCode
                "Explore" | "Plan" | "general-purpose" | "statusline-setup" => return AgentType::ClaudeCode,
                _ => {}
            }
        }

        // 4. 检查 model 字段（Claude 模型名）
        if let Some(model) = payload.get("model").and_then(|v| v.as_str()) {
            let m = model.to_lowercase();
            if m.contains("claude") { return AgentType::ClaudeCode; }
            if m.contains("gpt") || m.contains("codex") { return AgentType::Codex; }
        }

        // 5. 最后回退
        AgentType::Unknown
    }

    /// 获取 Agent 类型的字符串标识（用于窗口匹配等）
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentType::ClaudeCode => "claude-code",
            AgentType::Codex => "codex",
            AgentType::Cursor => "cursor",
            AgentType::Antigravity => "antigravity",
            AgentType::ClaudeDesktop => "claude-desktop",
            AgentType::Opencode => "opencode",
            AgentType::QwenCode => "qwen-code",
            AgentType::CodeBuddy => "codebuddy",
            AgentType::Windsurf => "windsurf",
            AgentType::Unknown => "unknown",
        }
    }
}

/// Agent 会话状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Idle,
    Thinking,
    Waiting,
    Error,
    Disconnected,
}

/// 待处理的权限请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingPermission {
    pub tool_name: String,
    pub tool_input: serde_json::Value,
    pub description: String,
    pub timestamp: DateTime<Utc>,
}

/// 单个 Agent 会话
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSession {
    pub id: String,
    pub agent_type: AgentType,
    pub status: AgentStatus,
    pub name: String,
    pub cwd: String,
    pub started_at: DateTime<Utc>,
    pub last_event_at: DateTime<Utc>,
    pub pending_permission: Option<PendingPermission>,
    pub pending_question: Option<String>,
    pub last_tool: Option<String>,
}

/// Hook 事件 payload（从 Claude Code 等 Agent 接收）
///
/// Claude Code 真实事件格式参考:
/// - SessionStart: { session_id, hook_event_name, cwd, source, model }
/// - PreToolUse:   { session_id, hook_event_name, tool_name, tool_input, tool_use_id }
/// - PostToolUse:  { session_id, hook_event_name, tool_name, tool_input, tool_response }
/// - Notification: { session_id, hook_event_name, message, title, notification_type }
///   notification_type: "permission_prompt" | "idle_prompt" | "elicitation_dialog"
/// - Stop:         { session_id, hook_event_name }
#[derive(Debug, Deserialize)]
pub struct HookEventPayload {
    pub session_id: Option<String>,
    pub hook_event_name: String,
    pub cwd: Option<String>,
    pub transcript_path: Option<String>,
    pub tool_name: Option<String>,
    pub tool_input: Option<serde_json::Value>,
    pub tool_response: Option<serde_json::Value>,
    pub message: Option<String>,
    pub title: Option<String>,
    pub notification_type: Option<String>,
    pub permission_mode: Option<String>,
    pub source: Option<String>,
    pub model: Option<String>,
    pub agent_type: Option<String>,
}

/// 会话管理器
pub struct SessionManager {
    /// 所有活跃会话 (session_id -> AgentSession)
    sessions: HashMap<String, AgentSession>,
    /// 挂起的权限请求响应通道 (session_id -> oneshot sender)
    permission_channels: HashMap<String, oneshot::Sender<PermissionDecision>>,
}

/// 权限审批结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionDecision {
    pub decision: String, // "allow", "deny"
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            permission_channels: HashMap::new(),
        }
    }

    /// 处理收到的 Hook 事件，更新会话状态
    pub fn handle_event(&mut self, payload: &HookEventPayload, raw: &serde_json::Value) -> Option<AgentSession> {
        let session_id = payload.session_id.clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        let event_name = payload.hook_event_name.as_str();

        // 获取或创建会话
        let session = self.sessions.entry(session_id.clone()).or_insert_with(|| {
            let agent_type = AgentType::from_hook_event(raw);
            let cwd = payload.cwd.clone().unwrap_or_default();
            // 从工作目录提取项目名作为会话名称
            let name = cwd.split(['/', '\\']).last()
                .unwrap_or("Unknown")
                .to_string();

            AgentSession {
                id: session_id.clone(),
                agent_type,
                status: AgentStatus::Idle,
                name,
                cwd,
                started_at: Utc::now(),
                last_event_at: Utc::now(),
                pending_permission: None,
                pending_question: None,
                last_tool: None,
            }
        });

        session.last_event_at = Utc::now();

        // 根据事件类型更新状态
        match event_name {
            "SessionStart" => {
                session.status = AgentStatus::Idle;
            }
            "PreToolUse" => {
                session.status = AgentStatus::Thinking;
                session.last_tool = payload.tool_name.clone();
                // 新事件来了，清除之前的等待状态
                session.pending_question = None;
                session.pending_permission = None;
            }
            "PostToolUse" => {
                session.status = AgentStatus::Thinking;
                session.last_tool = payload.tool_name.clone();
                session.pending_question = None;
            }
            "PermissionRequest" => {
                session.status = AgentStatus::Waiting;
                session.pending_permission = Some(PendingPermission {
                    tool_name: payload.tool_name.clone().unwrap_or_default(),
                    tool_input: payload.tool_input.clone().unwrap_or(serde_json::Value::Null),
                    description: payload.message.clone().unwrap_or_default(),
                    timestamp: Utc::now(),
                });
            }
            "Notification" => {
                let ntype = payload.notification_type.as_deref().unwrap_or("");
                let msg = payload.message.clone().unwrap_or_default();

                match ntype {
                    // 权限请求！这是真实的 Claude Code 权限弹窗
                    "permission_prompt" => {
                        log::info!("识别到权限请求通知: {}", msg);
                        session.status = AgentStatus::Waiting;
                        session.pending_permission = Some(PendingPermission {
                            tool_name: payload.title.clone().unwrap_or_else(|| "Permission".to_string()),
                            tool_input: serde_json::Value::Null,
                            description: msg,
                            timestamp: Utc::now(),
                        });
                    }
                    // AskUserQuestion 等交互式对话框
                    "elicitation_dialog" => {
                        log::info!("识别到用户确认对话框: {}", msg);
                        session.status = AgentStatus::Waiting;
                        session.pending_question = Some(msg);
                    }
                    // 空闲等待用户输入
                    "idle_prompt" => {
                        session.status = AgentStatus::Waiting;
                        session.pending_question = Some(
                            if msg.is_empty() { "Waiting for your input...".to_string() } else { msg }
                        );
                    }
                    // 其他通知类型（auth_success 等）不改状态
                    _ => {
                        // 检测消息是否像提问
                        if !msg.is_empty() {
                            let ml = msg.to_lowercase();
                            if ml.contains('?') || ml.contains("？")
                                || ml.contains("waiting") || ml.contains("选择") {
                                session.status = AgentStatus::Waiting;
                                session.pending_question = Some(msg);
                            }
                        }
                    }
                }
            }
            "Question" | "AskUser" => {
                session.status = AgentStatus::Waiting;
                session.pending_question = payload.message.clone();
            }
            "SubagentStop" => {
                // 子代理完成，不通知用户，静默更新状态
                session.status = AgentStatus::Thinking;
                session.last_tool = Some("subagent done".to_string());
            }
            "Stop" => {
                // 主 turn 结束，回到空闲
                // 不主动弹出——等 Notification(idle_prompt) 来决定是否弹
                session.status = AgentStatus::Idle;
                session.pending_permission = None;
                session.pending_question = None;
            }
            "SessionEnd" => {
                session.status = AgentStatus::Disconnected;
            }
            _ => {
                // 其他事件保持当前状态
            }
        }

        Some(session.clone())
    }

    /// 获取所有活跃会话列表
    pub fn get_sessions(&self) -> Vec<AgentSession> {
        self.sessions.values().cloned().collect()
    }

    /// 注册权限响应通道（挂起 HTTP 请求等待用户审批）
    pub fn register_permission_channel(&mut self, session_id: &str, sender: oneshot::Sender<PermissionDecision>) {
        self.permission_channels.insert(session_id.to_string(), sender);
    }

    /// 响应权限请求（用户在面板上点击 Allow/Deny）
    pub fn respond_permission(&mut self, session_id: &str, decision: &str) -> bool {
        // 清除 pending 状态
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.pending_permission = None;
            session.status = AgentStatus::Thinking;
        }

        // 发送决策到挂起的 HTTP 响应
        if let Some(sender) = self.permission_channels.remove(session_id) {
            let _ = sender.send(PermissionDecision {
                decision: decision.to_string(),
            });
            true
        } else {
            false
        }
    }

    /// 清除提问状态（用户已回复）
    pub fn clear_question(&mut self, session_id: &str) {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.pending_question = None;
            if session.status == AgentStatus::Waiting {
                session.status = AgentStatus::Thinking;
            }
        }
    }

    /// 移除断开的会话
    pub fn remove_session(&mut self, session_id: &str) {
        self.sessions.remove(session_id);
        self.permission_channels.remove(session_id);
    }
}
