// 灵动岛主容器
// 折叠态根据事件类型切换不同动效：
//   权限请求 → 黄色脉冲 + 微摇 (island-urgent)
//   完成通知 → 绿色闪烁一次 (island-done-flash)
//   默认 → 静态

import { useCallback, useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  const dragStarted = useRef(false);

  // "done" 通知闪烁后自动清除
  const [doneFlash, setDoneFlash] = useState(false);
  useEffect(() => {
    if (notify === "done" && !isExpanded) {
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

  // 折叠态动效 class
  const collapsedClass = () => {
    if (isExpanded) return "";
    if (hasAnyPending) return "island-urgent";
    if (doneFlash) return "island-done-flash";
    return "";
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, input, .no-drag")) return;

    dragStarted.current = false;
    const startX = e.screenX;
    const startY = e.screenY;

    const onMove = (ev: MouseEvent) => {
      if (dragStarted.current) return;
      if (Math.abs(ev.screenX - startX) > 5 || Math.abs(ev.screenY - startY) > 5) {
        dragStarted.current = true;
        cleanup();
        getCurrentWindow().startDragging().catch(() => {});
      }
    };

    const onUp = () => {
      cleanup();
      if (!dragStarted.current && !isExpanded) {
        toggleExpanded();
      }
    };

    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [isExpanded, toggleExpanded]);

  return (
    <motion.div
      layout
      onMouseDown={handleMouseDown}
      animate={{
        width: isExpanded ? "min(96vw, 460px)" : collapsedWidth,
        height: isExpanded ? "auto" : 38,
        borderRadius: isExpanded ? 20 : 999,
      }}
      transition={isExpanded ? SPRING_OPEN : SPRING_CLOSE}
      className={collapsedClass()}
      style={{
        background: "#2e3440",
        boxShadow: "0 0 0 1px rgba(136,192,208,0.1), 0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(216,222,233,0.06)",
        overflow: "hidden",
        cursor: isExpanded ? "default" : "grab",
        marginTop: 6,
        minHeight: 38,
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
