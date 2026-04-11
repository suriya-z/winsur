// Agent 卡片 — Nord 马卡龙配色
// 主行: 图标+名称+描述   右侧: 类型标签+时间
// 展开: 权限审批(Deny/Allow) 或 提问回复(输入框) 或 完成态(Done — click to jump)

import { motion, AnimatePresence } from "motion/react";
import { ShieldAlert } from "lucide-react";
import { StatusDot } from "../shared/StatusDot";
import { AgentIcon, getAgentColor, getAgentLabel } from "../shared/AgentIcon";
import { QuestionReply } from "./QuestionReply";
import { respondPermission, focusTerminal } from "../../lib/tauri";
import { useAgentStore } from "../../stores/agentStore";
import type { AgentSession } from "../../types/agent";

const STATUS_INFO: Record<string, { text: string; color: string }> = {
  idle: { text: "Done — click to jump", color: "#a3be8c" },
  thinking: { text: "Working", color: "#88c0d0" },
  waiting: { text: "Needs input", color: "#ebcb8b" },
  error: { text: "Error", color: "#bf616a" },
  disconnected: { text: "Offline", color: "#4c566a" },
};

export function AgentCard({ agent }: { agent: AgentSession }) {
  const agentColor = getAgentColor(agent.agent_type);
  const agentLabel = getAgentLabel(agent.agent_type);
  const hasPending = agent.pending_permission !== null;
  const hasQuestion = agent.pending_question !== null && !hasPending;
  // "Awaiting your input..." 是 Stop 事件产生的轻量通知，不需要回复输入框
  const isAwaitingInput = hasQuestion && agent.pending_question === "Awaiting your input...";
  // 真正的提问需要回复输入框（排除 awaiting input）
  const hasRealQuestion = hasQuestion && !isAwaitingInput;
  const info = STATUS_INFO[agent.status] || STATUS_INFO.idle;

  const elapsed = () => {
    const m = Math.floor((Date.now() - new Date(agent.last_event_at).getTime()) / 60000);
    if (m < 1) return "now";
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h`;
  };

  const updateAgent = useAgentStore((s) => s.updateAgent);

  const handleJump = async (e: React.MouseEvent) => {
    e.stopPropagation();
    // 立即清除等待状态（不管跳转是否成功）
    if (agent.pending_question || agent.status === "waiting") {
      updateAgent({
        ...agent,
        pending_question: null,
        status: "idle",
      });
    }
    try {
      await focusTerminal(agent.id);
    } catch (err) {
      console.error("跳转:", err);
    }
  };

  return (
    <motion.div
      layout
      layoutId={`agent-${agent.id}`}
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className={`no-drag ${hasPending ? "card-glow-permission" : hasRealQuestion ? "card-glow-question" : isAwaitingInput ? "card-glow-question" : ""} ${agent.status === "thinking" ? "shimmer-thinking" : ""}`}
      onClick={!hasPending && !hasRealQuestion ? handleJump : undefined}
      style={{
        background: hasPending ? "#3b3528" : hasQuestion ? "#2e3a40" : "#3b4252",
        borderRadius: 14,
        padding: "10px 12px",
        border: hasPending ? "1px solid #5a4a2a" : hasRealQuestion ? "1px solid #3a5060" : isAwaitingInput ? "1px solid #3a5060" : "1px solid #434c5e",
        borderLeft: isAwaitingInput ? "3px solid #ebcb8b" : undefined,
        cursor: hasPending || hasRealQuestion ? "default" : "pointer",
        transition: "border-color 0.3s, box-shadow 0.3s",
      }}
    >
      {/* 主行 */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>

        {/* Agent 图标 */}
        <div style={{
          width: 30,
          height: 30,
          borderRadius: 9,
          background: `color-mix(in srgb, ${agentColor} 15%, #2e3440)`,
          border: `1px solid color-mix(in srgb, ${agentColor} 25%, transparent)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}>
          <AgentIcon type={agent.agent_type} size={14} color={agentColor} />
        </div>

        {/* 名称 + 状态 + 活动详情 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13,
            fontWeight: 600,
            lineHeight: 1.2,
            color: "#eceff4",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {agent.name || agentLabel}
          </div>
          {/* 状态行 */}
          <div style={{
            fontSize: 11,
            marginTop: 2,
            display: "flex",
            alignItems: "center",
            gap: 4,
            color: info.color,
          }}>
            <StatusDot status={agent.status} size={5} />
            <span>{agent.status === "thinking" && agent.last_tool ? `${agent.last_tool}` : isAwaitingInput ? "Awaiting input" : info.text}</span>
          </div>
          {/* 工作目录（缩短显示） */}
          {agent.cwd && (
            <div style={{
              fontSize: 9.5,
              marginTop: 2,
              color: "#4c566a",
              fontFamily: "var(--font-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {agent.cwd.replace(/\\/g, "/").split("/").slice(-2).join("/")}
            </div>
          )}
        </div>

        {/* 右侧标签和时间 */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginTop: 2 }}>
          <span style={{
            padding: "2px 8px",
            borderRadius: 6,
            fontSize: 10,
            fontWeight: 600,
            background: `color-mix(in srgb, ${agentColor} 15%, #2e3440)`,
            color: agentColor,
            border: `1px solid color-mix(in srgb, ${agentColor} 25%, transparent)`,
          }}>
            {agentLabel}
          </span>
          <span style={{ fontSize: 10.5, color: "#4c566a", fontVariantNumeric: "tabular-nums" }}>
            {elapsed()}
          </span>
        </div>
      </div>

      {/* === 等待输入提示（轻量，可点击跳转） === */}
      {isAwaitingInput && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 8px",
            borderRadius: 8,
            background: "rgba(235,203,139,0.08)",
            border: "1px solid rgba(235,203,139,0.15)",
            fontSize: 11,
            color: "#ebcb8b",
            cursor: "pointer",
          }}
          onClick={handleJump}
        >
          <motion.div
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 2, repeat: Infinity }}
            style={{ width: 6, height: 6, borderRadius: "50%", background: "#ebcb8b", flexShrink: 0 }}
          />
          Awaiting your input — click to jump
        </motion.div>
      )}

      {/* === 提问回复区域（真正的提问，有输入框） === */}
      <AnimatePresence>
        {hasRealQuestion && agent.pending_question && (
          <QuestionReply
            key="question"
            sessionId={agent.id}
            question={agent.pending_question}
          />
        )}
      </AnimatePresence>

      {/* === 权限审批区域 === */}
      <AnimatePresence>
        {hasPending && agent.pending_permission && (
          <motion.div
            key="perm"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: "spring", stiffness: 280, damping: 24 }}
            style={{ marginTop: 10 }}
          >
            {/* 请求标题 */}
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              marginBottom: 6,
              fontSize: 11,
              color: "#d08770",
              fontWeight: 500,
            }}>
              <ShieldAlert size={12} />
              Permission Request
            </div>

            {/* 工具信息 */}
            <div style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              padding: "8px 10px",
              background: "#2e3440",
              borderRadius: 10,
              border: "1px solid #434c5e",
              marginBottom: 10,
              lineHeight: 1.6,
              overflow: "hidden",
            }}>
              <div style={{ color: "#ebcb8b", fontWeight: 600, marginBottom: 2 }}>
                {agent.pending_permission.tool_name}
              </div>
              {agent.pending_permission.description && (
                <div style={{ color: "#d8dee9", fontSize: 10.5, opacity: 0.7 }}>
                  {agent.pending_permission.description.slice(0, 120)}
                </div>
              )}
            </div>

            {/* Deny / Allow 按钮（紧凑版） */}
            <div style={{ display: "flex", gap: 6 }}>
              <motion.button
                whileHover={{ scale: 1.03, backgroundColor: "#434c5e" }}
                whileTap={{ scale: 0.95 }}
                onClick={(e) => { e.stopPropagation(); respondPermission(agent.id, "deny").catch(() => {}); }}
                style={{
                  flex: 1,
                  padding: "5px 0",
                  borderRadius: 8,
                  border: "1px solid #4c566a",
                  background: "#3b4252",
                  color: "#d8dee9",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                }}
              >
                Deny
                <kbd style={{
                  fontSize: 8,
                  padding: "0px 4px",
                  borderRadius: 3,
                  background: "#2e3440",
                  border: "1px solid #4c566a",
                  color: "#4c566a",
                  fontFamily: "var(--font-mono)",
                }}>ESC</kbd>
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.03, filter: "brightness(1.12)" }}
                whileTap={{ scale: 0.95 }}
                onClick={(e) => { e.stopPropagation(); respondPermission(agent.id, "allow").catch(() => {}); }}
                style={{
                  flex: 1,
                  padding: "5px 0",
                  borderRadius: 8,
                  border: "none",
                  background: "linear-gradient(135deg, #a3be8c, #8fbcbb)",
                  color: "#2e3440",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  boxShadow: "0 2px 8px rgba(163,190,140,0.2)",
                }}
              >
                Allow
                <kbd style={{
                  fontSize: 8,
                  padding: "0px 4px",
                  borderRadius: 3,
                  background: "rgba(46,52,64,0.3)",
                  border: "1px solid rgba(46,52,64,0.3)",
                  color: "rgba(46,52,64,0.7)",
                  fontFamily: "var(--font-mono)",
                }}>Enter</kbd>
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
