// Collapsed capsule — one fleet dot, label, chevron. Width does not follow agent count.

import { motion } from "motion/react";
import { useAgentStore } from "../../stores/agentStore";
import { notchSummary } from "./notchSummary";

export function CollapsedView() {
  const agents = useAgentStore((s) => s.agents);
  const summary = notchSummary(agents);
  const glow =
    summary.level === "error"
      ? "0 0 10px rgba(248,113,113,0.45)"
      : summary.level === "waiting"
        ? "0 0 10px rgba(251,191,36,0.45)"
        : summary.level === "working"
          ? "0 0 8px rgba(96,165,250,0.45)"
          : summary.level === "idle"
            ? "0 0 8px rgba(74,222,128,0.3)"
            : "none";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 16px",
        height: 38,
        minWidth: 0,
      }}
    >
      <motion.div
        animate={{
          backgroundColor: summary.dot,
          boxShadow: glow,
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
          color: summary.text,
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {summary.label}
      </motion.span>

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
