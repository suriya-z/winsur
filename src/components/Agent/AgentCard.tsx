// Agent card — permissions = required; free-chat reply = optional (user opens)

import { motion, AnimatePresence } from "motion/react";
import { ShieldAlert, X } from "lucide-react";
import { StatusDot } from "../shared/StatusDot";
import { getAgentLabel } from "../shared/agentMeta";
import { QuestionReply } from "./QuestionReply";
import { PlanReview } from "./PlanReview";
import { dismissAgent, respondPermission, focusTerminal } from "../../lib/bridge";
import { playSound } from "../../lib/sounds";
import type { AgentSession } from "../../types/agent";

const STATUS_INFO: Record<string, { text: string; color: string }> = {
  idle: { text: "Done — click to jump", color: "var(--accent-green)" },
  thinking: { text: "Working", color: "var(--status-thinking)" },
  waiting: { text: "Action required", color: "var(--accent-yellow)" },
  error: { text: "Error", color: "var(--accent-red)" },
  disconnected: { text: "Offline", color: "var(--text-muted)" },
};

export function AgentCard({ agent }: { agent: AgentSession }) {
  const agentLabel = getAgentLabel(agent.agent_type);
  const hasPending = agent.pending_permission !== null;
  /** Real required question from agent (elicitation / AskUser) — auto show */
  const requiredQuestion = agent.pending_question;
  const pendingPlan = agent.pending_plan;

  const info = STATUS_INFO[agent.status] || STATUS_INFO.idle;

  const elapsed = () => {
    // Wall-clock by nature. The store repolls every 2s, so the label refreshes
    // without needing its own ticking state.
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    const m = Math.floor((now - new Date(agent.last_event_at).getTime()) / 60000);
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

  const showReply = !pendingPlan && (!!requiredQuestion || !hasPending);
  const canJump = !hasPending && !requiredQuestion && !pendingPlan;

  return (
    <motion.div
      layout
      layoutId={`agent-${agent.id}`}
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className={`no-drag ${hasPending ? "card-glow-permission" : requiredQuestion || pendingPlan ? "card-glow-question" : ""} ${agent.status === "thinking" ? "shimmer-thinking" : ""}`}
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
        cursor: "default",
        transition: "border-color 0.3s, box-shadow 0.3s",
      }}
    >
      <div
        onClick={canJump ? handleJump : undefined}
        style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)", cursor: canJump ? "pointer" : "default" }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "var(--type-name)",
              fontWeight: 600,
              lineHeight: 1.25,
              letterSpacing: "-0.011em",
              textWrap: "balance",
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
              fontSize: "var(--type-meta)",
              fontWeight: 500,
              marginTop: "var(--space-1)",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-1)",
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
                fontSize: "var(--type-meta)",
                fontWeight: 400,
                marginTop: "var(--space-1)",
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
            gap: "var(--space-1)",
            flexShrink: 0,
          }}
        >
          <motion.button
            className="no-drag"
            type="button"
            aria-label={`Dismiss ${agent.name || agentLabel}`}
            whileHover={{ scale: 1.06, backgroundColor: "rgba(255,255,255,0.08)" }}
            whileTap={{ scale: 0.94 }}
            onClick={(e) => {
              e.stopPropagation();
              dismissAgent(agent.id).catch(() => {});
            }}
            title="Dismiss"
            style={{
              width: 24,
              height: 24,
              padding: 0,
              borderRadius: 6,
              border: "1px solid var(--border-subtle)",
              background: "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={12} />
          </motion.button>
          <span
            style={{
              fontSize: "var(--type-meta)",
              fontWeight: 500,
              color: "var(--text-secondary)",
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
            question={requiredQuestion || ""}
            lastReply={agent.last_reply}
            optional={!requiredQuestion}
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
