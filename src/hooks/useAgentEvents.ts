// Agent 事件监听
// 监听 Tauri 后端 emit 的 agent-update 事件

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useAgentStore } from "../stores/agentStore";
import type { AgentSession } from "../types/agent";

export function useAgentEvents() {
  const updateAgent = useAgentStore((s) => s.updateAgent);
  const setAgents = useAgentStore((s) => s.setAgents);

  useEffect(() => {
    invoke<AgentSession[]>("get_agents")
      .then(setAgents)
      .catch((err) => console.warn("获取 Agent 列表失败:", err));

    const unlistenUpdate = listen<AgentSession>("agent-update", (event) => {
      updateAgent(event.payload);
    });

    return () => {
      unlistenUpdate.then((fn) => fn());
    };
  }, [updateAgent, setAgents]);
}
