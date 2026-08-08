// 灵动岛主容器
// 折叠态根据事件类型切换不同动效：
//   权限请求 → 黄色脉冲 + 微摇 (island-urgent)
//   完成通知 → 绿色闪烁一次 (island-done-flash)
//   默认 → 静态

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { bindClickOrDrag, stopWindowDragging } from "../../lib/bridge";
import { useAgentStore } from "../../stores/agentStore";
import { CollapsedView } from "./CollapsedView";
import { ExpandedView } from "./ExpandedView";

const SPRING_OPEN = { type: "spring" as const, stiffness: 224, damping: 24, mass: 1 };
const SPRING_CLOSE = { type: "tween" as const, duration: 0.28, ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number] };

export function IslandContainer() {
  const isExpanded = useAgentStore((s) => s.isExpanded);
  const hasAnyPending = useAgentStore((s) => s.hasAnyPending);
  const notify = useAgentStore((s) => s.notify);
  const clearNotify = useAgentStore((s) => s.clearNotify);
  const toggleExpanded = useAgentStore((s) => s.toggleExpanded);
  const agents = useAgentStore((s) => s.agents);

  // Safety: always kill drag if window blurs / tab hides
  useEffect(() => {
    const stop = () => stopWindowDragging();
    window.addEventListener("blur", stop);
    window.addEventListener("mouseup", stop);
    window.addEventListener("pointerup", stop);
    return () => {
      window.removeEventListener("blur", stop);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("pointerup", stop);
      stopWindowDragging();
    };
  }, []);

  const [doneFlash, setDoneFlash] = useState(false);
  useEffect(() => {
    if (notify === "done" && !isExpanded) {
      // Transient flash driven by a store notification, not by render state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDoneFlash(true);
      clearNotify();
      const t = setTimeout(() => setDoneFlash(false), 1500);
      return () => clearTimeout(t);
    }
    if (notify === "permission" || notify === "question") {
      clearNotify();
    }
  }, [notify, isExpanded, clearNotify]);

  const collapsedWidth = Math.max(220, Math.min(360, 180 + agents.length * 28));

  const collapsedClass = () => {
    if (isExpanded) return "";
    if (hasAnyPending) return "island-urgent";
    if (doneFlash) return "island-done-flash";
    return "";
  };

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button, input, .no-drag")) return;

      bindClickOrDrag(e, {
        onClick: () => {
          if (!isExpanded) toggleExpanded();
        },
      });
    },
    [isExpanded, toggleExpanded]
  );

  return (
    <motion.div
      layout
      onPointerDown={handlePointerDown}
      animate={{
        width: isExpanded ? "min(96vw, 460px)" : collapsedWidth,
        height: isExpanded ? "auto" : 38,
        borderRadius: isExpanded ? 20 : 999,
      }}
      transition={isExpanded ? SPRING_OPEN : SPRING_CLOSE}
      className={collapsedClass()}
      style={{
        background: "var(--bg-primary)",
        boxShadow: "var(--shadow-island)",
        border: "1px solid var(--border-subtle)",
        overflow: "hidden",
        cursor: isExpanded ? "default" : "grab",
        marginTop: 6,
        minHeight: 38,
        touchAction: "none",
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {isExpanded ? (
          <motion.div
            key="expanded"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <ExpandedView />
          </motion.div>
        ) : (
          <motion.div
            key="collapsed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <CollapsedView />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
