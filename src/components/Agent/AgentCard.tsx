// Agent card — permissions = required; free-chat reply = optional (user opens)

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ShieldAlert, MessageSquare, X } from "lucide-react";
import { StatusDot } from "../shared/StatusDot";
import { AgentIcon, getAgentColor, getAgentLabel } from "../shared/AgentIcon";
import { QuestionReply } from "./QuestionReply";
import { PlanReview } from "./PlanReview";
import { respondPermission, focusTerminal } from "../../lib/tauri";
import { playSound } from "../../lib/sounds";
import type { AgentSession } from "../../types/agent";

const STATUS_INFO: Record<string, { text: string; color: string }> = {
  idle: { text: "Done — click to jump", color: "var(--accent-green)" },
  thinking: { text: "Working", color: "var(--accent-blue)" },
  waiting: { text: "Action required", color: "var(--accent-yellow)" },
  error: { text: "Error", color: "var(--accent-red)" },
  disconnected: { text: "Offline", color: "var(--text-muted)" },
};

export function AgentCard({ agent }: { agent: AgentSession }) {
  const agentColor = getAgentColor(agent.agent_type);
  const agentLabel = getAgentLabel(agent.agent_type);
  const hasPending = agent.pending_permission !== null;
  /** Real required question from agent (elicitation / AskUser) — auto show */
  const requiredQuestion = agent.pending_question;
  const pendingPlan = agent.pending_plan;
  /** Optional compose box — user toggles; never auto for normal chat */
  const [showComposer, setShowComposer] = useState(false);

  const info = STATUS_INFO[agent.status] || STATUS_INFO.idle;

  const elapsed = () => {
    const m = Math.floor((Date.now() - new Date(agent.last_event_at).getTime()) / 60000);
    if (m < 1) return "now";
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h`;
  };

  const handleJump = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      const res = await focusTerminal(agent.id);
      const ok = typeof res === "boolean" ? res : !!res?.ok;
      if (ok) playSound("jump");
      if (!ok) {
        console.warn("jump failed", typeof res === "object" ? res?.detail : res);
      }
    } catch (err) {
      console.error("jump:", err);
    }
  };

  const openComposer = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowComposer((v) => !v);
  };

  const showReply =
    !!requiredQuestion || (showComposer && !hasPending);

  return (
    <motion.div
      layout
      layoutId={`agent-${agent.id}`}
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className={`no-drag ${hasPending ? "card-glow-permission" : requiredQuestion || pendingPlan ? "card-glow-question" : ""} ${agent.status === "thinking" ? "shimmer-thinking" : ""}`}
      onClick={
        !hasPending && !requiredQuestion && !pendingPlan && !showComposer
          ? handleJump
          : undefined
      }
      style={{
        background: hasPending
          ? "rgba(251, 191, 36, 0.04)"
          : requiredQuestion || pendingPlan
          ? "rgba(148, 163, 184, 0.04)"
          : "var(--bg-card)",
        borderRadius: 14,
        padding: "10px 12px",
        border: hasPending
          ? "1px solid rgba(251, 191, 36, 0.22)"
          : requiredQuestion || pendingPlan
          ? "1px solid rgba(148, 163, 184, 0.18)"
          : "1px solid var(--border-default)",
        cursor:
          hasPending || requiredQuestion || pendingPlan || showComposer
            ? "default"
            : "pointer",
        transition: "border-color 0.3s, box-shadow 0.3s",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            background: `color-mix(in srgb, ${agentColor} 12%, #0a0a0a)`,
            border: `1px solid color-mix(in srgb, ${agentColor} 22%, transparent)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <AgentIcon type={agent.agent_type} size={14} color={agentColor} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              lineHeight: 1.2,
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {agent.name || agentLabel}
          </div>
          <div
            style={{
              fontSize: 11,
              marginTop: 2,
              display: "flex",
              alignItems: "center",
              gap: 4,
              color: info.color,
            }}
          >
            <StatusDot status={agent.status} size={5} />
            <span>
              {agent.status === "thinking" && agent.last_tool
                ? agent.last_tool
                : hasPending
                ? "Permission needed"
                : pendingPlan
                ? "Plan review"
                : requiredQuestion
                ? "Needs your answer"
                : info.text}
            </span>
          </div>
          {agent.cwd && (
            <div
              style={{
                fontSize: 9.5,
                marginTop: 2,
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {agent.cwd.replace(/\\/g, "/").split("/").slice(-2).join("/")}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            flexShrink: 0,
            marginTop: 2,
          }}
        >
          {/* Optional message — never auto-open for normal chat */}
          {!hasPending && (
            <motion.button
              className="no-drag"
              whileHover={{ scale: 1.06, backgroundColor: "rgba(255,255,255,0.08)" }}
              whileTap={{ scale: 0.94 }}
              onClick={openComposer}
              title={showComposer ? "Close message box" : "Send optional message to agent"}
              style={{
                padding: "4px 6px",
                borderRadius: 6,
                border: "1px solid var(--border-subtle)",
                background: showComposer ? "rgba(255,255,255,0.08)" : "transparent",
                color: showComposer ? "var(--text-primary)" : "var(--text-muted)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
              }}
            >
              {showComposer ? <X size={12} /> : <MessageSquare size={12} />}
            </motion.button>
          )}
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 6,
              fontSize: 10,
              fontWeight: 600,
              background: `color-mix(in srgb, ${agentColor} 12%, #0a0a0a)`,
              color: agentColor,
              border: `1px solid color-mix(in srgb, ${agentColor} 22%, transparent)`,
            }}
          >
            {agentLabel}
          </span>
          <span
            style={{
              fontSize: 10.5,
              color: "var(--text-muted)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {elapsed()}
          </span>
        </div>
      </div>

      <AnimatePresence>
        {pendingPlan && (
          <PlanReview key="plan" sessionId={agent.id} plan={pendingPlan} />
        )}
      </AnimatePresence>

      {/* Optional or required reply box */}
      <AnimatePresence>
        {showReply && !pendingPlan && (
          <QuestionReply
            key={requiredQuestion ? "required" : "optional"}
            sessionId={agent.id}
            question={
              requiredQuestion ||
              "Optional — message will be typed into the agent terminal"
            }
            optional={!requiredQuestion}
            onClose={
              requiredQuestion
                ? undefined
                : () => setShowComposer(false)
            }
          />
        )}
      </AnimatePresence>

      {/* Permission — always required, always auto */}
      <AnimatePresence>
        {hasPending && agent.pending_permission && (
          <motion.div
            key="perm"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: "spring", stiffness: 280, damping: 24 }}
            style={{ marginTop: 10 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                marginBottom: 6,
                fontSize: 11,
                color: "var(--accent-orange)",
                fontWeight: 500,
              }}
            >
              <ShieldAlert size={12} />
              Permission Request
            </div>

            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                padding: "8px 10px",
                background: "var(--bg-inset)",
                borderRadius: 10,
                border: "1px solid var(--border-default)",
                marginBottom: 10,
                lineHeight: 1.6,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  color: "var(--accent-yellow)",
                  fontWeight: 600,
                  marginBottom: 2,
                }}
              >
                {agent.pending_permission.tool_name}
              </div>
              {agent.pending_permission.description && (
                <div
                  style={{
                    color: "var(--text-secondary)",
                    fontSize: 10.5,
                    opacity: 0.85,
                  }}
                >
                  {agent.pending_permission.description.slice(0, 120)}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 6 }}>
              <motion.button
                whileHover={{ scale: 1.02, backgroundColor: "var(--bg-hover)" }}
                whileTap={{ scale: 0.96 }}
                onClick={(e) => {
                  e.stopPropagation();
                  respondPermission(agent.id, "deny").catch(() => {});
                }}
                style={{
                  flex: 1,
                  padding: "6px 0",
                  borderRadius: 8,
                  border: "1px solid var(--border-default)",
                  background: "var(--bg-elevated)",
                  color: "var(--text-secondary)",
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
                <kbd
                  style={{
                    fontSize: 8,
                    padding: "0px 4px",
                    borderRadius: 3,
                    background: "var(--bg-inset)",
                    border: "1px solid var(--border-subtle)",
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  ESC
                </kbd>
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.02, filter: "brightness(1.08)" }}
                whileTap={{ scale: 0.96 }}
                onClick={(e) => {
                  e.stopPropagation();
                  respondPermission(agent.id, "allow").catch(() => {});
                }}
                style={{
                  flex: 1,
                  padding: "6px 0",
                  borderRadius: 8,
                  border: "1px solid rgba(244, 244, 245, 0.12)",
                  background: "var(--text-primary)",
                  color: "#0a0a0a",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  boxShadow: "0 1px 0 rgba(255,255,255,0.12) inset",
                }}
              >
                Allow
                <kbd
                  style={{
                    fontSize: 8,
                    padding: "0px 4px",
                    borderRadius: 3,
                    background: "rgba(0,0,0,0.12)",
                    border: "1px solid rgba(0,0,0,0.1)",
                    color: "rgba(0,0,0,0.55)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  Enter
                </kbd>
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
