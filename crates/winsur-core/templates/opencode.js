// Winsur zero-config plugin for OpenCode
const HOOK_URL = "http://127.0.0.1:18900/hooks/event";

async function postWinsur(payload) {
  try {
    await fetch(HOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Winsur offline — fail open
  }
}

export default async ({ directory, worktree }) => {
  const cwd = directory || worktree || process.cwd();
  void postWinsur({
    hook_event_name: "SessionStart",
    session_id: "opencode-" + Buffer.from(String(cwd)).toString("hex").slice(0, 16),
    cwd,
    agent_type: "opencode",
  });

  return {
    "chat.message": async (input) => {
      await postWinsur({
        hook_event_name: "UserPromptSubmit",
        session_id: input?.sessionID || "opencode",
        cwd,
        agent_type: "opencode",
      });
    },
    "tool.execute.before": async (input, output) => {
      await postWinsur({
        hook_event_name: "PreToolUse",
        session_id: input?.sessionID || "opencode",
        tool_name: input?.tool || "tool",
        tool_input: output?.args || {},
        cwd,
        agent_type: "opencode",
      });
    },
    "tool.execute.after": async (input) => {
      await postWinsur({
        hook_event_name: "PostToolUse",
        session_id: input?.sessionID || "opencode",
        tool_name: input?.tool || "tool",
        cwd,
        agent_type: "opencode",
      });
    },
    "permission.ask": async (input) => {
      await postWinsur({
        hook_event_name: "Notification",
        notification_type: "permission_prompt",
        session_id: input?.sessionID || "opencode",
        title: input?.title || "Permission",
        message: input?.title || "OpenCode needs permission",
        cwd,
        agent_type: "opencode",
      });
    },
    event: async ({ event }) => {
      const t = String(event?.type || "");
      if (t === "session.idle" || t === "session.status") {
        const isIdle = t === "session.idle" || event?.properties?.status?.type === "idle";
        if (isIdle) {
          await postWinsur({
            hook_event_name: "Stop",
            session_id: event?.properties?.sessionID || "opencode",
            cwd,
            agent_type: "opencode",
          });
        }
      }
    },
  };
};
