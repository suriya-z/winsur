// Tauri IPC 封装
// 功能：封装 Tauri invoke 调用，提供类型安全的 API

import { invoke } from "@tauri-apps/api/core";
import type { AgentSession, Settings } from "../types/agent";

/** 获取所有 Agent 会话 */
export async function getAgents(): Promise<AgentSession[]> {
  return invoke<AgentSession[]>("get_agents");
}

/** 响应权限请求 */
export async function respondPermission(
  sessionId: string,
  decision: "allow" | "deny"
): Promise<boolean> {
  return invoke<boolean>("respond_permission", {
    sessionId,
    decision,
  });
}

/** 聚焦到对应终端窗口 */
export async function focusTerminal(sessionId: string): Promise<boolean> {
  return invoke<boolean>("focus_terminal", { sessionId });
}

/** 获取应用设置 */
export async function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

/** 从面板中移除 Agent */
export async function dismissAgent(sessionId: string): Promise<void> {
  return invoke<void>("dismiss_agent", { sessionId });
}

/** 向 Agent 终端发送回复消息 */
export async function replyQuestion(
  sessionId: string,
  message: string,
): Promise<boolean> {
  return invoke<boolean>("reply_question", { sessionId, message });
}

/** 安装 Agent hooks（配置 Claude Code 等 Agent 的 hooks 指向 Vibe Island） */
export async function installHooks(): Promise<string> {
  return invoke<string>("install_hooks");
}

/** 卸载 Agent hooks */
export async function uninstallHooks(): Promise<string> {
  return invoke<string>("uninstall_hooks");
}

/** 检查 hooks 安装状态 */
export async function checkHooks(): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>("check_hooks");
}
