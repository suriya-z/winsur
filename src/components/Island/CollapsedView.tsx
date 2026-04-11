// 折叠态 — 精致胶囊 + 事件通知动效
// 空闲: 绿灯 + Agent 数
// 权限等待: 黄灯脉冲 + 待处理数量徽标
// 完成: 绿色闪烁

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

  // 摘要文字
  const summaryText = () => {
    if (hasPending) return "Permission needed";
    if (hasAnyPending) return "Needs your input";
    if (workingCount > 0) return `${workingCount} working`;
    if (activeCount > 0) return `${activeCount} agent${activeCount > 1 ? "s" : ""}`;
    return "Vibe Island";
  };

  const summaryColor = () => {
    if (hasPending) return "#ebcb8b";
    if (hasAnyPending) return "#8fbcbb";
    if (workingCount > 0) return "#88c0d0";
    if (activeCount > 0) return "#a3be8c";
    return "#d8dee9";
  };

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "0 16px",
      height: 38,
    }}>
      {/* 状态指示灯 */}
      <motion.div
        animate={{
          backgroundColor: hasPending ? "#ebcb8b" : hasAnyPending ? "#8fbcbb" : (activeCount > 0 ? "#a3be8c" : "#4c566a"),
          boxShadow: hasPending
            ? "0 0 8px rgba(235,203,139,0.5)"
            : hasAnyPending
            ? "0 0 8px rgba(143,188,187,0.5)"
            : (activeCount > 0 ? "0 0 6px rgba(163,190,140,0.4)" : "none"),
        }}
        transition={{ duration: 0.4 }}
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          flexShrink: 0,
        }}
      />

      {/* 主文字 */}
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

      {/* Agent 状态点 */}
      {agents.length > 0 && (
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {agents.slice(0, 6).map((agent) => (
            <StatusDot key={agent.id} status={agent.status} size={5} />
          ))}
        </div>
      )}

      {/* 待处理数量徽标 */}
      {attentionCount > 0 && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="badge-bounce"
          style={{
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            background: hasPending ? "#ebcb8b" : "#8fbcbb",
            color: "#2e3440",
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

      {/* 展开箭头 */}
      <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.3, flexShrink: 0 }}>
        <path d="M2 4 L5 7 L8 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );
}
