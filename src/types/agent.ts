// Agent types — multi-agent control surface

export type AgentType =
  | "claude-code"
  | "codex"
  | "cursor"
  | "antigravity"
  | "claude-desktop"
  | "opencode"
  | "qwen-code"
  | "code-buddy"
  | "windsurf"
  | "grok-build"
  | "gemini"
  | "zcode"
  | "trae"
  | "mimocode"
  | "droid"
  | "qoder"
  | "kimi"
  | "deepseek"
  | "mistral"
  | "copilot"
  | "workbuddy"
  | "kiro"
  | "hermes"
  | "amp"
  | "pi-agent"
  | "oh-my-pi"
  | "gajae"
  | "unknown";

export type AgentStatus = "idle" | "thinking" | "waiting" | "error" | "disconnected";

export interface PendingPermission {
  tool_name: string;
  tool_input: Record<string, unknown>;
  description: string;
  timestamp: string;
}

export interface PendingPlan {
  markdown: string;
  title: string;
  timestamp: string;
}

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
  pending_plan?: PendingPlan | null;
  last_tool: string | null;
  remote_host?: string | null;
}

export interface PermissionRequestEvent {
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  message: string;
}

export interface Settings {
  httpPort: number;
  soundEnabled: boolean;
  soundVolume: number;
  autoStart: boolean;
  theme: "dark" | "light";
}

export interface UsageRow {
  id: string;
  name: string;
  label: string;
  used: number | null;
  limit: number | null;
  remaining: number | null;
  resetsAt: string | null;
  detail: string;
  ok: boolean;
}

export interface SshRemote {
  id: string;
  name: string;
  host: string;
  remotePort?: number;
  enabled?: boolean;
  connected?: boolean;
}
