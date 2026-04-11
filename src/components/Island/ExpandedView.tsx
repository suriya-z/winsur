// 展开态 - 完整面板
// 标题栏可拖拽，Agent 卡片列表，匹配 Vibe Island 布局

import { useCallback, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronUp, Radio, Settings } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AgentCard } from "../Agent/AgentCard";
import { HookSettings } from "../Settings/HookSettings";
import { useAgentStore } from "../../stores/agentStore";

export function ExpandedView() {
  const agents = useAgentStore((s) => s.agents);
  const setExpanded = useAgentStore((s) => s.setExpanded);
  const [showSettings, setShowSettings] = useState(false);

  // 标题栏拖拽 — 直接在 mousedown 调用 startDragging
  const handleTitleDrag = useCallback(async (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    try {
      await getCurrentWindow().startDragging();
    } catch {}
  }, []);

  return (
    <div>
      {/* 标题栏 - 可拖拽 */}
      <div
        onMouseDown={handleTitleDrag}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "10px 14px 6px",
          gap: 6,
          cursor: "grab",
        }}
      >
        <Radio size={11} style={{ color: "var(--accent-blue)", opacity: 0.6 }} />
        <span style={{
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          flex: 1,
        }}>
          Vibe Island
        </span>

        <motion.button
          className="no-drag"
          whileHover={{ scale: 1.15, backgroundColor: "rgba(255,255,255,0.08)" }}
          whileTap={{ scale: 0.9 }}
          onClick={() => setShowSettings(!showSettings)}
          style={{
            background: showSettings ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
            border: "none",
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
          whileHover={{ scale: 1.15, backgroundColor: "rgba(255,255,255,0.08)" }}
          whileTap={{ scale: 0.9 }}
          onClick={() => setExpanded(false)}
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "none",
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

      {/* 分隔线 */}
      <div style={{
        height: 1,
        background: "linear-gradient(90deg, transparent 5%, rgba(255,255,255,0.07) 30%, rgba(255,255,255,0.07) 70%, transparent 95%)",
        margin: "0 14px 6px",
      }} />

      {/* 设置面板 */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
          >
            <HookSettings />
            <div style={{
              height: 1,
              background: "linear-gradient(90deg, transparent 5%, rgba(255,255,255,0.07) 30%, rgba(255,255,255,0.07) 70%, transparent 95%)",
              margin: "0 14px 6px",
            }} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Agent 卡片列表 */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "0 10px 10px",
        maxHeight: 420,
        overflowY: "auto",
      }}>
        <AnimatePresence mode="popLayout">
          {agents.length > 0 ? (
            agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{ textAlign: "center", padding: "28px 16px" }}
            >
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7 }}>
                <div style={{ color: "var(--text-secondary)", marginBottom: 2 }}>
                  Waiting for connections...
                </div>
                <div style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  opacity: 0.5,
                  background: "rgba(255,255,255,0.03)",
                  display: "inline-block",
                  padding: "2px 8px",
                  borderRadius: 4,
                }}>
                  localhost:18900
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
