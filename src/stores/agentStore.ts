// Agent 状态管理 (Zustand)
// 自动展开：权限请求/提问时展开面板
// 自动折叠：所有待处理项清空后折叠
// 事件通知：完成/权限请求时触发动效标记

import { create } from "zustand";
import type { AgentSession } from "../types/agent";
import { preferSession } from "./agentMerge";

/** 通知类型 */
export type NotifyType = "permission" | "done" | "question" | "plan" | null;

interface AgentStore {
  agents: AgentSession[];
  isExpanded: boolean;
  hasPendingPermission: boolean;
  hasAnyPending: boolean;
  /** 最近一次通知类型（用于折叠态动效） */
  notify: NotifyType;
  /** 需要注意的 Agent 数量（权限+提问） */
  attentionCount: number;

  updateAgent: (agent: AgentSession) => void;
  removeAgent: (sessionId: string) => void;
  setAgents: (agents: AgentSession[]) => void;
  toggleExpanded: () => void;
  setExpanded: (expanded: boolean) => void;
  clearNotify: () => void;
}

/** Only things that REQUIRE user action (not optional free-chat). */
function checkPending(agents: AgentSession[]) {
  const hasPerm = agents.some((a) => a.pending_permission != null);
  const hasQuestion = agents.some((a) => a.pending_question != null);
  const hasPlan = agents.some((a) => a.pending_plan != null);
  const count = agents.filter(
    (a) =>
      a.pending_permission != null ||
      a.pending_question != null ||
      a.pending_plan != null
  ).length;
  return {
    hasPerm,
    hasQuestion,
    hasPlan,
    hasAny: hasPerm || hasQuestion || hasPlan,
    count,
  };
}

export const useAgentStore = create<AgentStore>((set) => ({
  agents: [],
  isExpanded: false,
  hasPendingPermission: false,
  hasAnyPending: false,
  notify: null,
  attentionCount: 0,

  updateAgent: (agent) =>
    set((state) => {
      if (agent.status === "disconnected") {
        const newAgents = state.agents.filter((a) => a.id !== agent.id);
        const { hasPerm, hasAny, count } = checkPending(newAgents);
        const shouldCollapse = state.hasAnyPending && !hasAny;
        return {
          agents: newAgents,
          hasPendingPermission: hasPerm,
          hasAnyPending: hasAny,
          attentionCount: count,
          isExpanded: shouldCollapse ? false : state.isExpanded,
        };
      }

      const norm = (c: string) =>
        String(c || "")
          .replace(/\//g, "\\")
          .replace(/\\+$/, "")
          .toLowerCase();
      const sameCard = (a: AgentSession, b: AgentSession) =>
        a.id === b.id ||
        (a.agent_type === b.agent_type &&
          norm(a.cwd) === norm(b.cwd) &&
          (a.remote_host || "") === (b.remote_host || ""));

      const existing = state.agents.findIndex((a) => sameCard(a, agent));
      const oldAgent = existing >= 0 ? state.agents[existing] : null;
      let newAgents: AgentSession[];
      if (existing >= 0) {
        newAgents = [...state.agents];
        const kept = preferSession(oldAgent, agent);
        // Keep stable id for UI keys when merging
        newAgents[existing] = { ...kept, id: newAgents[existing].id };
      } else {
        newAgents = [...state.agents, agent];
      }
      // Drop any other duplicates of this card
      newAgents = newAgents.filter(
        (a, i) => newAgents.findIndex((b) => sameCard(a, b)) === i
      );

      const { hasPerm, hasAny, count } = checkPending(newAgents);
      const wasPending = state.hasAnyPending;

      // Only expand / urgent for real required action — never for free-chat / idle
      let notify: NotifyType = state.notify;
      if (agent.pending_permission != null && oldAgent?.pending_permission == null) {
        notify = "permission";
      } else if (
        agent.pending_plan != null &&
        oldAgent?.pending_plan == null &&
        agent.status === "waiting"
      ) {
        notify = "plan";
      } else if (
        agent.pending_question != null &&
        oldAgent?.pending_question == null &&
        agent.status === "waiting"
      ) {
        notify = "question";
      } else if (
        agent.status === "idle" &&
        oldAgent &&
        oldAgent.status !== "idle" &&
        oldAgent.status !== "disconnected"
      ) {
        notify = "done";
      }

      // Auto-expand only on permission or required question — not on "done"
      const shouldExpand = hasAny;
      const shouldCollapse = wasPending && !hasAny;

      return {
        agents: newAgents,
        hasPendingPermission: hasPerm,
        hasAnyPending: hasAny,
        attentionCount: count,
        notify,
        isExpanded: shouldExpand ? true : shouldCollapse ? false : state.isExpanded,
      };
    }),

  removeAgent: (sessionId) =>
    set((state) => {
      const newAgents = state.agents.filter((a) => a.id !== sessionId);
      const { hasPerm, hasAny, count } = checkPending(newAgents);
      return { agents: newAgents, hasPendingPermission: hasPerm, hasAnyPending: hasAny, attentionCount: count };
    }),

  setAgents: (agents) =>
    set((state) => {
      const next = agents
        .filter((a) => a.status !== "disconnected")
        .map((agent) => {
          const current =
            state.agents.find(
              (old) =>
                old.id === agent.id ||
                (old.agent_type === agent.agent_type &&
                  String(old.cwd || "")
                    .replace(/\//g, "\\")
                    .replace(/\\+$/, "")
                    .toLowerCase() ===
                    String(agent.cwd || "")
                      .replace(/\//g, "\\")
                      .replace(/\\+$/, "")
                      .toLowerCase() &&
                  (old.remote_host || "") === (agent.remote_host || "")),
            ) ?? null;
          const kept = preferSession(current, agent);
          return current ? { ...kept, id: current.id } : kept;
        });
      const { hasPerm, hasAny, count } = checkPending(next);
      const shouldExpand = hasAny;
      const shouldCollapse = state.hasAnyPending && !hasAny;
      return {
        agents: next,
        hasPendingPermission: hasPerm,
        hasAnyPending: hasAny,
        attentionCount: count,
        isExpanded: shouldExpand ? true : shouldCollapse ? false : state.isExpanded,
      };
    }),

  toggleExpanded: () => set((state) => ({ isExpanded: !state.isExpanded })),
  setExpanded: (expanded) => set({ isExpanded: expanded }),
  clearNotify: () => set({ notify: null }),
}));
