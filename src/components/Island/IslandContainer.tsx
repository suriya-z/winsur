// 灵动岛主容器
// 折叠态根据事件类型切换不同动效：
//   权限请求 → 黄色脉冲 + 微摇 (island-urgent)
//   完成通知 → 绿色闪烁一次 (island-done-flash)
//   默认 → 静态

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { bindClickOrDrag, reportIslandMetrics, stopWindowDragging } from "../../lib/bridge";
import { useAgentStore } from "../../stores/agentStore";
import { CollapsedView } from "./CollapsedView";
import { ExpandedView } from "./ExpandedView";
import { COLLAPSED_NOTCH_WIDTH } from "./notchSummary";

const SPRING_OPEN = { type: "spring" as const, stiffness: 224, damping: 24, mass: 1 };
const SPRING_CLOSE = { type: "tween" as const, duration: 0.28, ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number] };
const EXPANDED_WIDTH = 460;

function visibleRadius(style: CSSStyleDeclaration, width: number, height: number) {
  const parsed = Number.parseFloat(style.borderTopLeftRadius || style.borderRadius || "0");
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(parsed, width / 2, height / 2));
}

export function IslandContainer() {
  const isExpanded = useAgentStore((s) => s.isExpanded);
  const hasAnyPending = useAgentStore((s) => s.hasAnyPending);
  const notify = useAgentStore((s) => s.notify);
  const clearNotify = useAgentStore((s) => s.clearNotify);
  const toggleExpanded = useAgentStore((s) => s.toggleExpanded);
  const islandRef = useRef<HTMLDivElement>(null);

  // The main process hit-tests the cursor against this rectangle. Measuring
  // every frame keeps the window (and the click-through shape) on the visible
  // island during the expand/collapse animation, not on a padded bounding box.
  useEffect(() => {
    let frame = 0;
    let last = "";
    const tick = () => {
      const el = islandRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const radius = visibleRadius(getComputedStyle(el), rect.width, rect.height);
        const key = [
          rect.left.toFixed(1),
          rect.top.toFixed(1),
          rect.width.toFixed(1),
          rect.height.toFixed(1),
          radius.toFixed(1),
        ].join("|");
        if (key !== last && rect.width > 0 && rect.height > 0) {
          last = key;
          reportIslandMetrics({
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
            radius,
          });
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    const stop = () => stopWindowDragging();
    window.addEventListener("blur", stop);
    window.addEventListener("mouseup", stop);
    window.addEventListener("pointerup", stop);
    return () => {
      cancelAnimationFrame(frame);
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

  const collapsedWidth = COLLAPSED_NOTCH_WIDTH;

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
      ref={islandRef}
      layout
      onPointerDown={handlePointerDown}
      animate={{
        width: isExpanded ? EXPANDED_WIDTH : collapsedWidth,
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
