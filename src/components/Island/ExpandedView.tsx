// Expanded panel — Winsur title + agents or live idle status

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronUp, Radio, Settings } from "lucide-react";
import { bindClickOrDrag, checkHooks } from "../../lib/bridge";
import { AgentCard } from "../Agent/AgentCard";
import { HookSettings } from "../Settings/HookSettings";
import { ProPanel } from "../Settings/ProPanel";
import { useAgentStore } from "../../stores/agentStore";

export function ExpandedView() {
  const agents = useAgentStore((s) => s.agents);
  const setExpanded = useAgentStore((s) => s.setExpanded);
  const [showSettings, setShowSettings] = useState(false);
  const [hookSummary, setHookSummary] = useState({ installed: 0, detected: 0, total: 0 });

  useEffect(() => {
    const load = () => {
      checkHooks()
        .then((s) => {
          const entries = Object.entries(s).filter(
            ([k, v]) =>
              k !== "hook_script" &&
              k !== "agent_count" &&
              v &&
              typeof v === "object"
          ) as [string, { detected?: boolean; installed?: boolean }][];
          setHookSummary({
            total: entries.length,
            detected: entries.filter(([, v]) => v.detected).length,
            installed: entries.filter(([, v]) => v.installed).length,
          });
        })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const handleTitlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    bindClickOrDrag(e);
  }, []);

  return (
    <div>
      <div
        onPointerDown={handleTitlePointerDown}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "10px 14px 6px",
          gap: 6,
          cursor: "grab",
          touchAction: "none",
        }}
      >
        <Radio size={11} style={{ color: "var(--accent-blue)", opacity: 0.85 }} />
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--text-primary)",
            flex: 1,
          }}
        >
          Winsur
        </span>

        <motion.button
          className="no-drag"
          whileHover={{ scale: 1.1, backgroundColor: "rgba(255,255,255,0.06)" }}
          whileTap={{ scale: 0.92 }}
          onClick={() => setShowSettings(!showSettings)}
          style={{
            background: showSettings ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
            border: "1px solid var(--border-subtle)",
            cursor: "pointer",
            padding: "3px 7px",
            borderRadius: 6,
            color: "var(--text-muted)",
            display: "flex",
            alignItems: "center",
          }}
        >
          <Settings size={12} />
        </motion.button>

        <motion.button
          className="no-drag"
          whileHover={{ scale: 1.1, backgroundColor: "rgba(255,255,255,0.06)" }}
          whileTap={{ scale: 0.92 }}
          onClick={() => setExpanded(false)}
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid var(--border-subtle)",
            cursor: "pointer",
            padding: "3px 7px",
            borderRadius: 6,
            color: "var(--text-muted)",
            display: "flex",
            alignItems: "center",
          }}
        >
          <ChevronUp size={12} />
        </motion.button>
      </div>

      <div
        style={{
          height: 1,
          background:
            "linear-gradient(90deg, transparent 5%, rgba(255,255,255,0.08) 30%, rgba(255,255,255,0.08) 70%, transparent 95%)",
          margin: "0 14px 6px",
        }}
      />

      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
          >
            <HookSettings />
            <ProPanel />
            <div
              style={{
                height: 1,
                background:
                  "linear-gradient(90deg, transparent 5%, rgba(255,255,255,0.08) 30%, rgba(255,255,255,0.08) 70%, transparent 95%)",
                margin: "0 14px 6px",
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          padding: "0 10px 10px",
          maxHeight: 420,
          overflowY: "auto",
        }}
      >
        <AnimatePresence mode="popLayout">
          {agents.length > 0 ? (
            agents.map((agent) => <AgentCard key={agent.id} agent={agent} />)
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{ textAlign: "center", padding: "22px 14px" }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  color: "var(--text-primary)",
                  marginBottom: 6,
                }}
              >
                WINSUR
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10 }}>
                Listening for agents
              </div>
              <div
                style={{
                  display: "inline-flex",
                  flexDirection: "column",
                  gap: 6,
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-default)",
                  fontSize: 11,
                  color: "var(--text-muted)",
                  lineHeight: 1.5,
                  minWidth: 220,
                }}
              >
                <div>
                  <span style={{ color: "var(--accent-green)" }}>{hookSummary.installed}</span>
                  {" hooked · "}
                  <span style={{ color: "var(--accent-yellow)" }}>{hookSummary.detected}</span>
                  {" detected · "}
                  {hookSummary.total} total
                </div>
                <div style={{ fontSize: 10.5, opacity: 0.9 }}>
                  Open gear → <b style={{ color: "var(--text-secondary)" }}>Install all</b>, then
                  run an agent (Grok: <b style={{ color: "var(--text-secondary)" }}>/hooks</b> →{" "}
                  <b style={{ color: "var(--text-secondary)" }}>r</b>).
                </div>
                <div style={{ fontSize: 10, opacity: 0.5, fontFamily: "var(--font-mono)" }}>
                  hook port :18900
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
