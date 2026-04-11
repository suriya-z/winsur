// Agent 类型定义
// 与 Rust 后端的数据结构保持一致

/** Agent 类型 */
export type AgentType = "claude-code" | "codex" | "cursor" | "antigravity" | "claude-desktop" | "opencode" | "qwen-code" | "code-buddy" | "windsurf" | "unknown";

/** Agent 会话状态 */
export type AgentStatus = "idle" | "thinking" | "waiting" | "error" | "disconnected";

/** 待处理的权限请求 */
export interface PendingPermission {
  tool_name: string;
  tool_input: Record<string, unknown>;
  description: string;
  timestamp: string;
}

/** Agent 会话 */
export interface AgentSession {
  id: string;
  agent_type: AgentType;
  status: AgentStatus;
  name: string;
  cwd: string;
  started_at: string;
  last_event_at: string;
  pending_permission: PendingPermission | null;
  pending_question: string | null;
  last_tool: string | null;
}

/** 权限请求事件 */
export interface PermissionRequestEvent {
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  message: string;
}

/** 应用设置 */
export interface Settings {
  httpPort: number;
  soundEnabled: boolean;
  soundVolume: number;
  autoStart: boolean;
  theme: "dark" | "light";
}
