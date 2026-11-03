// One fleet rollup for the collapsed notch. The pill does not grow a dot per agent.

export const COLLAPSED_NOTCH_WIDTH = 248;

export type NotchLevel = "error" | "waiting" | "working" | "idle" | "empty";

export interface NotchAgent {
  status: string;
  pending_permission?: unknown;
  pending_question?: string | null;
  pending_plan?: unknown;
}

export interface NotchSummary {
  level: NotchLevel;
  /** Agents in the winning bucket. Zero when the fleet is empty. */
  count: number;
  label: string;
  dot: string;
  text: string;
}

const DOT: Record<NotchLevel, string> = {
  error: "#f87171",
  waiting: "#fbbf24",
  working: "#60a5fa",
  idle: "#4ade80",
  empty: "#3f3f46",
};

const TEXT: Record<NotchLevel, string> = {
  error: "var(--status-error)",
  waiting: "var(--accent-yellow)",
  working: "var(--status-thinking)",
  idle: "var(--accent-green)",
  empty: "var(--text-secondary)",
};

function needsUser(agent: NotchAgent): boolean {
  return (
    agent.status === "waiting" ||
    agent.pending_permission != null ||
    !!agent.pending_question ||
    agent.pending_plan != null
  );
}

/** error > waiting > working > idle. Disconnected rows do not count. */
export function notchSummary(agents: readonly NotchAgent[]): NotchSummary {
  let errors = 0;
  let waiting = 0;
  let working = 0;
  let idle = 0;
  for (const agent of agents) {
    if (agent.status === "disconnected") continue;
    if (agent.status === "error") {
      errors += 1;
    } else if (needsUser(agent)) {
      waiting += 1;
    } else if (agent.status === "thinking") {
      working += 1;
    } else {
      idle += 1;
    }
  }
  const total = errors + waiting + working + idle;
  if (total === 0) {
    return { level: "empty", count: 0, label: "Winsur · listening", dot: DOT.empty, text: TEXT.empty };
  }
  if (errors > 0) {
    const noun = errors === 1 ? "error" : "errors";
    return {
      level: "error",
      count: errors,
      label: `Winsur · ${errors} ${noun}`,
      dot: DOT.error,
      text: TEXT.error,
    };
  }
  if (waiting > 0) {
    return {
      level: "waiting",
      count: waiting,
      label: `Winsur · ${waiting} waiting`,
      dot: DOT.waiting,
      text: TEXT.waiting,
    };
  }
  if (working > 0) {
    return {
      level: "working",
      count: working,
      label: `Winsur · ${working} working`,
      dot: DOT.working,
      text: TEXT.working,
    };
  }
  const noun = idle === 1 ? "agent" : "agents";
  return {
    level: "idle",
    count: idle,
    label: `Winsur · ${idle} ${noun}`,
    dot: DOT.idle,
    text: TEXT.idle,
  };
}
