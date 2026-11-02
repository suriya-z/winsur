// Collapsed capsule — same layout, obsidian colors

import { motion } from "motion/react";
import { StatusDot } from "../shared/StatusDot";
import { useAgentStore } from "../../stores/agentStore";

export function CollapsedView() {
  const agents = useAgentStore((s) => s.agents);
  const hasPending = useAgentStore((s) => s.hasPendingPermission);
  const hasAnyPending = useAgentStore((s) => s.hasAnyPending);
  const attentionCount = useAgentStore((s) => s.attentionCount);
  const activeCount = agents.filter((a) => a.status !== "disconnected").length;
  const workingCount = agents.filter((a) => a.status === "thinking").length;

  const summaryText = () => {
    // "Needs you" only for real blocks (permission / required answer) — not free chat
    if (hasPending) return "Winsur · permission";
    if (hasAnyPending) return "Winsur · action needed";
    if (workingCount > 0) return `Winsur · ${workingCount} working`;
    if (activeCount > 0) return `Winsur · ${activeCount} agent${activeCount > 1 ? "s" : ""}`;
    return "Winsur · listening";
  };

  const summaryColor = () => {
    if (hasPending) return "var(--accent-yellow)";
    if (hasAnyPending) return "var(--status-thinking)";
    if (workingCount > 0) return "var(--text-secondary)";
    if (activeCount > 0) return "var(--accent-green)";
    return "var(--text-secondary)";
  };

  const dotColor = hasPending
    ? "#fbbf24"
    : hasAnyPending
    ? "#60a5fa"
    : activeCount > 0
    ? "#4ade80"
    : "#3f3f46";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 16px",
        height: 38,
      }}
    >
      <motion.div
        animate={{
          backgroundColor: dotColor,
          boxShadow: hasPending
            ? "0 0 10px rgba(251,191,36,0.45)"
            : hasAnyPending
            ? "0 0 8px rgba(96,165,250,0.45)"
            : activeCount > 0
            ? "0 0 8px rgba(74,222,128,0.3)"
            : "none",
        }}
        transition={{ duration: 0.4 }}
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          flexShrink: 0,
        }}
      />

      <motion.span
        layout
        style={{
          fontSize: 13,
          fontWeight: 500,
          letterSpacing: "0.01em",
          color: summaryColor(),
          flex: 1,
          whiteSpace: "nowrap",
        }}
      >
        {summaryText()}
      </motion.span>

      {agents.length > 0 && (
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {agents.slice(0, 6).map((agent) => (
            <StatusDot key={agent.id} status={agent.status} size={5} />
          ))}
        </div>
      )}

      {attentionCount > 0 && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="badge-arrive"
          style={{
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            background: hasPending ? "var(--accent-yellow)" : "var(--accent-blue)",
            color: "#0a0a0a",
            fontSize: 10,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 4px",
            flexShrink: 0,
          }}
        >
          {attentionCount}
        </motion.div>
      )}

      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        style={{ opacity: 0.35, flexShrink: 0, color: "var(--text-muted)" }}
      >
        <path
          d="M2 4 L5 7 L8 4"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
