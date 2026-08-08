// Plan review — Markdown preview + approve / feedback

import { useState } from "react";
import { motion } from "motion/react";
import { FileText, Check, MessageSquare } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { respondPlan, dismissPlan } from "../../lib/bridge";
import { playSound } from "../../lib/sounds";
import type { PendingPlan } from "../../types/agent";

export function PlanReview({
  sessionId,
  plan,
}: {
  sessionId: string;
  plan: PendingPlan;
}) {
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const run = async (decision: "approve" | "feedback") => {
    setBusy(true);
    setErr("");
    try {
      const res = await respondPlan(
        sessionId,
        decision,
        decision === "feedback" ? feedback : undefined
      );
      if (!res.ok) setErr(res.detail || "Failed to send");
      else playSound("send");
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="no-drag"
      onClick={(e) => e.stopPropagation()}
      style={{ marginTop: 10 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          marginBottom: 6,
          fontSize: 11,
          color: "var(--accent-purple, #a78bfa)",
          fontWeight: 500,
        }}
      >
        <FileText size={12} />
        {plan.title || "Plan review"}
      </div>

      <div
        style={{
          maxHeight: 180,
          overflowY: "auto",
          padding: "10px 12px",
          background: "var(--bg-inset)",
          borderRadius: 10,
          border: "1px solid var(--border-default)",
          fontSize: 11.5,
          lineHeight: 1.55,
          color: "var(--text-secondary)",
          marginBottom: 8,
        }}
        className="plan-md"
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{plan.markdown}</ReactMarkdown>
      </div>

      <input
        className="no-drag"
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="Optional feedback before approve…"
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "7px 10px",
          borderRadius: 8,
          border: "1px solid var(--border-default)",
          background: "var(--bg-inset)",
          color: "var(--text-primary)",
          fontSize: 12,
          marginBottom: 8,
          outline: "none",
        }}
      />

      <div style={{ display: "flex", gap: 6 }}>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          disabled={busy}
          onClick={() => run("feedback")}
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
          <MessageSquare size={12} />
          Feedback
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          disabled={busy}
          onClick={() => run("approve")}
          style={{
            flex: 1,
            padding: "6px 0",
            borderRadius: 8,
            border: "none",
            background: "var(--text-primary)",
            color: "#0a0a0a",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
          }}
        >
          <Check size={12} />
          Approve plan
        </motion.button>
      </div>
      {err && (
        <div style={{ marginTop: 6, fontSize: 10, color: "var(--accent-red)" }}>{err}</div>
      )}
      <button
        type="button"
        className="no-drag"
        onClick={() => dismissPlan(sessionId)}
        style={{
          marginTop: 6,
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          fontSize: 10,
          cursor: "pointer",
          padding: 0,
        }}
      >
        Dismiss
      </button>
    </motion.div>
  );
}
