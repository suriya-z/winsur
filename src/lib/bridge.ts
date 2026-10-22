// Platform bridge. The React UI calls these functions; Tauri commands and events
// implement them. window.winsur stays installed for callers that use the global.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { AgentSession, Settings, UsageRow, SshRemote } from "../types/agent";

type WinsurApi = {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  on: (channel: string, handler: (payload: unknown) => void) => () => void;
  startDragging: () => void;
  stopDragging?: () => void;
  setIgnoreMouseEvents?: (ignore: boolean, forward?: boolean) => void;
  reportIslandMetrics?: (metrics: {
    x: number;
    y: number;
    width: number;
    height: number;
    radius: number;
  }) => void;
  platform?: string;
};

declare global {
  interface Window {
    winsur?: WinsurApi;
    /** @deprecated use window.winsur */
    vibeIsland?: WinsurApi;
  }
}

function subscribe(channel: string, handler: (payload: unknown) => void): () => void {
  let unlisten: UnlistenFn | null = null;
  let cancelled = false;
  void listen(channel, (event) => handler(event.payload)).then((fn) => {
    if (cancelled) fn();
    else unlisten = fn;
  });
  return () => {
    cancelled = true;
    if (unlisten) unlisten();
  };
}

function installGlobal(): WinsurApi {
  const api: WinsurApi = {
    invoke: (cmd, args) => invoke(cmd, args),
    on: (channel, handler) => subscribe(channel, handler),
    startDragging: () => {
      void invoke("start_dragging");
    },
    stopDragging: () => {
      void invoke("stop_dragging");
    },
    setIgnoreMouseEvents: (ignore) => {
      void invoke("set_ignore_mouse_events", { ignore });
    },
    reportIslandMetrics: (metrics) => {
      void invoke("report_island_metrics", metrics);
    },
    platform: "win32",
  };
  window.winsur = api;
  window.vibeIsland = api;
  return api;
}

const bridge = installGlobal();

function api(): WinsurApi {
  return window.winsur ?? window.vibeIsland ?? bridge;
}

/** 获取所有 Agent 会话 */
export async function getAgents(): Promise<AgentSession[]> {
  return invoke<AgentSession[]>("get_agents");
}

/** 响应权限请求 */
export async function respondPermission(
  sessionId: string,
  decision: "allow" | "deny"
): Promise<boolean> {
  return invoke<boolean>("respond_permission", { sessionId, decision });
}

/** 聚焦到对应终端窗口 */
export async function focusTerminal(
  sessionId: string
): Promise<boolean | { ok: boolean; detail?: string }> {
  return invoke<{ ok: boolean; detail?: string }>("focus_terminal", { sessionId });
}

/** 获取应用设置 */
export async function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

export async function saveSettings(partial: Partial<Settings>): Promise<Settings> {
  return invoke<Settings>("save_settings", partial);
}

/** 从面板中移除 Agent */
export async function dismissAgent(sessionId: string): Promise<void> {
  await invoke("dismiss_agent", { sessionId });
}

/** 向 Agent 终端发送回复消息 */
export async function replyQuestion(
  sessionId: string,
  message: string
): Promise<boolean | { ok: boolean; detail?: string }> {
  return invoke<{ ok: boolean; detail?: string }>("reply_question", { sessionId, message });
}

export async function respondPlan(
  sessionId: string,
  decision: "approve" | "feedback",
  message?: string
): Promise<{ ok: boolean; detail?: string }> {
  return invoke<{ ok: boolean; detail?: string }>("respond_plan", { sessionId, decision, message });
}

export async function dismissPlan(sessionId: string) {
  return invoke("dismiss_plan", { sessionId });
}

/** 安装 Agent hooks */
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

export async function getUsage(): Promise<UsageRow[]> {
  return invoke<UsageRow[]>("get_usage");
}

export async function sshList(): Promise<SshRemote[]> {
  return invoke<SshRemote[]>("ssh_list");
}

export async function sshConnect(id: string) {
  return invoke("ssh_connect", { id });
}

export async function sshDisconnect(id: string) {
  return invoke("ssh_disconnect", { id });
}

export async function sshAdd(remote: Partial<SshRemote> & { host: string }): Promise<SshRemote[]> {
  return invoke<SshRemote[]>("ssh_add", remote);
}

export async function sshRemove(id: string): Promise<SshRemote[]> {
  return invoke<SshRemote[]>("ssh_remove", { id });
}

/** Listen for backend → UI events */
export function onAgentUpdate(handler: (session: AgentSession) => void): () => void {
  return api().on("agent-update", (payload) => handler(payload as AgentSession));
}

export function onAgentsSync(handler: (list: AgentSession[]) => void): () => void {
  return api().on("agents-sync", (payload) => {
    if (Array.isArray(payload)) handler(payload as AgentSession[]);
  });
}

/** Start window drag */
export function startWindowDragging(): void {
  try {
    api().startDragging();
  } catch {
    /* ignore outside the shell */
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

/** Tell the shell the visible island box so it can size the window and hit-test. */
export function reportIslandMetrics(metrics: {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}): void {
  try {
    api().reportIslandMetrics?.(metrics);
  } catch {
    /* ignore outside the shell */
  }
}

/** The shell polls the cursor itself. This call is accepted and ignored. */
export function setWindowIgnoreMouseEvents(ignore: boolean): void {
  try {
    api().setIgnoreMouseEvents?.(ignore, true);
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
  window.addEventListener("mousemove", onMoveMouse);
  window.addEventListener("mouseup", onUp);
  window.addEventListener("blur", onUp);
  document.addEventListener("visibilitychange", onVisibility);
}

export type { AgentSession, Settings, UsageRow, SshRemote };
