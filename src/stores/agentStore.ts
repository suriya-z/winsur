// Agent 状态管理 (Zustand)
// 自动展开：权限请求/提问时展开面板
// 自动折叠：所有待处理项清空后折叠
// 事件通知：完成/权限请求时触发动效标记

import { create } from "zustand";
import type { AgentSession } from "../types/agent";

/** 通知类型 */
export type NotifyType = "permission" | "done" | "question" | null;

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

function checkPending(agents: AgentSession[]) {
  const hasPerm = agents.some((a) => a.pending_permission != null);
  const hasQuestion = agents.some((a) => a.pending_question != null);
  const count = agents.filter((a) => a.pending_permission != null || a.pending_question != null).length;
  return { hasPerm, hasQuestion, hasAny: hasPerm || hasQuestion, count };
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
      const existing = state.agents.findIndex((a) => a.id === agent.id);
      const oldAgent = existing >= 0 ? state.agents[existing] : null;
      let newAgents: AgentSession[];
      if (existing >= 0) {
        newAgents = [...state.agents];
        newAgents[existing] = agent;
      } else {
        newAgents = [...state.agents, agent];
      }

      const { hasPerm, hasAny, count } = checkPending(newAgents);
      const wasPending = state.hasAnyPending;

      // 判断通知类型
      let notify: NotifyType = state.notify;
      if (agent.pending_permission != null && oldAgent?.pending_permission == null) {
        notify = "permission"; // 新权限请求
      } else if (agent.pending_question != null && oldAgent?.pending_question == null) {
        notify = "question"; // 新提问
      } else if (agent.status === "idle" && oldAgent && oldAgent.status !== "idle" && oldAgent.status !== "disconnected") {
        notify = "done"; // 刚完成
      }

      return {
        agents: newAgents,
        hasPendingPermission: hasPerm,
        hasAnyPending: hasAny,
        attentionCount: count,
        notify,
        isExpanded: hasAny ? true : (wasPending && !hasAny) ? false : state.isExpanded,
      };
    }),

  removeAgent: (sessionId) =>
    set((state) => {
      const newAgents = state.agents.filter((a) => a.id !== sessionId);
      const { hasPerm, hasAny, count } = checkPending(newAgents);
      return { agents: newAgents, hasPendingPermission: hasPerm, hasAnyPending: hasAny, attentionCount: count };
    }),

  setAgents: (agents) => {
    const { hasPerm, hasAny, count } = checkPending(agents);
    set({ agents, hasPendingPermission: hasPerm, hasAnyPending: hasAny, attentionCount: count });
  },

  toggleExpanded: () => set((state) => ({ isExpanded: !state.isExpanded })),
  setExpanded: (expanded) => set({ isExpanded: expanded }),
  clearNotify: () => set({ notify: null }),
}));
