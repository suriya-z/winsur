// Platform bridge — the full Electron IPC surface behind window.winsur.
// Was split across tauri.ts + bridge.ts; the Tauri runtime is long gone.

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { AgentSession, Settings, UsageRow, SshRemote } from "../types/agent";

type WinsurApi = {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  on: (channel: string, handler: (payload: unknown) => void) => () => void;
  startDragging: () => void;
  stopDragging?: () => void;
  platform?: string;
};

declare global {
  interface Window {
    winsur?: WinsurApi;
    /** @deprecated use window.winsur */
    vibeIsland?: WinsurApi;
  }
}

function api(): WinsurApi {
  if (window.winsur) return window.winsur;
  if (window.vibeIsland) return window.vibeIsland;
  throw new Error("Winsur bridge not available (run via Electron: npm start)");
}

/** 获取所有 Agent 会话 */
export async function getAgents(): Promise<AgentSession[]> {
  return api().invoke("get_agents") as Promise<AgentSession[]>;
}

/** 响应权限请求 */
export async function respondPermission(
  sessionId: string,
  decision: "allow" | "deny"
): Promise<boolean> {
  return api().invoke("respond_permission", {
    sessionId,
    decision,
  }) as Promise<boolean>;
}

/** 聚焦到对应终端窗口 */
export async function focusTerminal(
  sessionId: string
): Promise<boolean | { ok: boolean; detail?: string }> {
  return api().invoke("focus_terminal", { sessionId }) as Promise<
    boolean | { ok: boolean; detail?: string }
  >;
}

/** 获取应用设置 */
export async function getSettings(): Promise<Settings> {
  return api().invoke("get_settings") as Promise<Settings>;
}

export async function saveSettings(partial: Partial<Settings>): Promise<Settings> {
  return api().invoke("save_settings", partial as Record<string, unknown>) as Promise<Settings>;
}

/** 从面板中移除 Agent */
export async function dismissAgent(sessionId: string): Promise<void> {
  await api().invoke("dismiss_agent", { sessionId });
}

/** 向 Agent 终端发送回复消息 */
export async function replyQuestion(
  sessionId: string,
  message: string
): Promise<boolean | { ok: boolean; detail?: string }> {
  return api().invoke("reply_question", { sessionId, message }) as Promise<
    boolean | { ok: boolean; detail?: string }
  >;
}

export async function respondPlan(
  sessionId: string,
  decision: "approve" | "feedback",
  message?: string
): Promise<{ ok: boolean; detail?: string }> {
  return api().invoke("respond_plan", { sessionId, decision, message }) as Promise<{
    ok: boolean;
    detail?: string;
  }>;
}

export async function dismissPlan(sessionId: string) {
  return api().invoke("dismiss_plan", { sessionId });
}

/** 安装 Agent hooks */
export async function installHooks(): Promise<string> {
  return api().invoke("install_hooks") as Promise<string>;
}

/** 卸载 Agent hooks */
export async function uninstallHooks(): Promise<string> {
  return api().invoke("uninstall_hooks") as Promise<string>;
}

/** 检查 hooks 安装状态 */
export async function checkHooks(): Promise<Record<string, unknown>> {
  return api().invoke("check_hooks") as Promise<Record<string, unknown>>;
}

export async function getUsage(): Promise<UsageRow[]> {
  return api().invoke("get_usage") as Promise<UsageRow[]>;
}

export async function sshList(): Promise<SshRemote[]> {
  return api().invoke("ssh_list") as Promise<SshRemote[]>;
}

export async function sshConnect(id: string) {
  return api().invoke("ssh_connect", { id });
}

export async function sshDisconnect(id: string) {
  return api().invoke("ssh_disconnect", { id });
}

export async function sshAdd(remote: Partial<SshRemote> & { host: string }): Promise<SshRemote[]> {
  return api().invoke("ssh_add", remote as Record<string, unknown>) as Promise<SshRemote[]>;
}

export async function sshRemove(id: string): Promise<SshRemote[]> {
  return api().invoke("ssh_remove", { id }) as Promise<SshRemote[]>;
}

/** Listen for backend → UI events */
export function onAgentUpdate(handler: (session: AgentSession) => void): () => void {
  return api().on("agent-update", (payload) => handler(payload as AgentSession));
}

/** Start window drag (Electron) */
export function startWindowDragging(): void {
  try {
    api().startDragging();
  } catch {
    /* ignore in pure browser */
  }
}

/** Stop window drag — must be called on pointer/mouse up */
export function stopWindowDragging(): void {
  try {
    api().stopDragging?.();
  } catch {
    /* ignore */
  }
}

/**
 * Begin a click-or-drag gesture.
 * - Pointer capture keeps pointerup even when cursor leaves the window
 * - Drag starts after 5px movement; click (no drag) calls onClick
 */
export function bindClickOrDrag(
  e: ReactPointerEvent | ReactMouseEvent,
  opts: {
    onClick?: () => void;
    disabled?: boolean;
  } = {}
): void {
  if (opts.disabled) return;
  if ("button" in e && e.button !== 0) return;

  const target = e.currentTarget as HTMLElement;
  const startX = e.screenX;
  const startY = e.screenY;
  let dragging = false;
  const pointerId = "pointerId" in e ? e.pointerId : undefined;

  // Capture so we still get up events outside the window bounds
  if (pointerId != null && target.setPointerCapture) {
    try {
      target.setPointerCapture(pointerId);
    } catch {
      /* ignore */
    }
  }

  const end = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    window.removeEventListener("mousemove", onMoveMouse);
    window.removeEventListener("mouseup", onUp);
    window.removeEventListener("blur", onUp);
    document.removeEventListener("visibilitychange", onVisibility);

    if (dragging) {
      stopWindowDragging();
    } else if (opts.onClick) {
      opts.onClick();
    }
  };

  const maybeStartDrag = (x: number, y: number) => {
    if (dragging) return;
    if (Math.abs(x - startX) > 5 || Math.abs(y - startY) > 5) {
      dragging = true;
      startWindowDragging();
    }
  };

  const onMove = (ev: PointerEvent) => maybeStartDrag(ev.screenX, ev.screenY);
  const onMoveMouse = (ev: MouseEvent) => maybeStartDrag(ev.screenX, ev.screenY);
  const onUp = () => end();
  const onVisibility = () => {
    if (document.hidden) end();
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  // Fallback for environments without full pointer events
  window.addEventListener("mousemove", onMoveMouse);
  window.addEventListener("mouseup", onUp);
  window.addEventListener("blur", onUp);
  document.addEventListener("visibilitychange", onVisibility);
}

export type { AgentSession, Settings, UsageRow, SshRemote };
