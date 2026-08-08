// Extended IPC API surface
import type { AgentSession, Settings, UsageRow, SshRemote } from "../types/agent";

export {
  getAgents,
  respondPermission,
  focusTerminal,
  getSettings,
  dismissAgent,
  replyQuestion,
  installHooks,
  uninstallHooks,
  checkHooks,
  onAgentUpdate,
  startWindowDragging,
  stopWindowDragging,
  bindClickOrDrag,
} from "./tauri";

function api() {
  if (!window.vibeIsland) throw new Error("bridge missing");
  return window.vibeIsland;
}

export async function saveSettings( partial: Partial<Settings>) {
  return api().invoke("save_settings", partial as Record<string, unknown>) as Promise<Settings>;
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

export async function sshAdd(remote: Partial<SshRemote> & { host: string }) {
  return api().invoke("ssh_add", remote as Record<string, unknown>) as Promise<SshRemote[]>;
}

export async function sshRemove(id: string) {
  return api().invoke("ssh_remove", { id }) as Promise<SshRemote[]>;
}

export async function respondPlan(
  sessionId: string,
  decision: "approve" | "feedback",
  message?: string
) {
  return api().invoke("respond_plan", { sessionId, decision, message }) as Promise<{
    ok: boolean;
    detail?: string;
  }>;
}

export async function dismissPlan(sessionId: string) {
  return api().invoke("dismiss_plan", { sessionId });
}

export type { AgentSession, Settings, UsageRow, SshRemote };
