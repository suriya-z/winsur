// 状态指示圆点组件
// 根据 Agent 状态显示不同颜色和动画

import type { AgentStatus } from "../../types/agent";

/** 状态对应的样式映射 */
const STATUS_STYLES: Record<AgentStatus, { color: string; className: string; label: string }> = {
  idle: { color: "var(--status-idle)", className: "", label: "空闲" },
  thinking: { color: "var(--status-thinking)", className: "status-dot-thinking", label: "思考中" },
  waiting: { color: "var(--status-waiting)", className: "status-dot-waiting", label: "等待输入" },
  error: { color: "var(--status-error)", className: "status-dot-error", label: "错误" },
  disconnected: { color: "var(--status-idle)", className: "", label: "已断开" },
};

interface StatusDotProps {
  status: AgentStatus;
  size?: number;
}

export function StatusDot({ status, size = 8 }: StatusDotProps) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.idle;

  return (
    <span
      className={style.className}
      title={style.label}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: style.color,
        flexShrink: 0,
      }}
    />
  );
}
