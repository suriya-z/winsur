// 全局键盘快捷键
// Enter = Allow 最前面的权限请求
// Escape = Deny 最前面的权限请求 / 折叠面板

import { useEffect } from "react";
import { useAgentStore } from "../stores/agentStore";
import { respondPermission } from "../lib/bridge";

/**
 * 全局键盘快捷键处理
 *
 * Enter: 批准最前面的权限请求
 * Escape: 拒绝权限请求 / 折叠面板
 */
export function useKeyboardShortcuts() {
  const agents = useAgentStore((s) => s.agents);
  const isExpanded = useAgentStore((s) => s.isExpanded);
  const setExpanded = useAgentStore((s) => s.setExpanded);

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (typing) return;

      // 找到第一个有待处理权限的 Agent
      const pendingAgent = agents.find((a) => a.pending_permission !== null);

      if (e.key === "Enter" && pendingAgent) {
        e.preventDefault();
        try {
          await respondPermission(pendingAgent.id, "allow");
        } catch {
          /* ignore */
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (pendingAgent) {
          try {
            await respondPermission(pendingAgent.id, "deny");
          } catch {
            /* ignore */
          }
        } else if (isExpanded) {
          setExpanded(false);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [agents, isExpanded, setExpanded]);
}
