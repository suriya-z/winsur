// Agent event listening — IPC + poll + sound alerts

import { useEffect, useRef } from "react";
import { getAgents, onAgentUpdate, onAgentsSync, getSettings } from "../lib/bridge";
import { useAgentStore } from "../stores/agentStore";
import { playSound, setSoundEnabled, setSoundVolume } from "../lib/sounds";
import type { AgentSession } from "../types/agent";

export function useAgentEvents() {
  const updateAgent = useAgentStore((s) => s.updateAgent);
  const setAgents = useAgentStore((s) => s.setAgents);
  const notify = useAgentStore((s) => s.notify);
  const prevNotify = useRef<string | null>(null);

  useEffect(() => {
    void getSettings()
      .then((s) => {
        setSoundEnabled(s.soundEnabled);
        setSoundVolume(s.soundVolume);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!notify || notify === prevNotify.current) return;
    prevNotify.current = notify;
    if (notify === "done") playSound("done");
    if (notify === "permission") playSound("permission");
    if (notify === "question") playSound("question");
    if (notify === "plan") playSound("plan");
  }, [notify]);

  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      getAgents()
        .then((list) => {
          if (!cancelled) setAgents(list as AgentSession[]);
        })
        .catch((err) => console.warn("Failed to load agents:", err));
    };

    refresh();
    const poll = window.setInterval(refresh, 2000);

    const unlisten = onAgentUpdate((session) => {
      updateAgent(session);
    });

    const unlistenSync = onAgentsSync((list) => {
      if (!cancelled) setAgents(list);
    });

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      unlisten();
      unlistenSync();
    };
  }, [updateAgent, setAgents]);
}
