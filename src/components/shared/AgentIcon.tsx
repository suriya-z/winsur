// Agent 宿主图标组件
// 为每个 Agent 宿主提供独特的辨识图标

import type { AgentType } from "../../types/agent";

interface AgentIconProps {
  type: AgentType;
  size?: number;
  color?: string;
}

/**
 * 内联 SVG 图标，每个宿主独特形状，无需外部图标文件
 * 设计风格：简洁线条 + 几何图形，保持一致的视觉重量
 */
export function AgentIcon({ type, size = 14, color = "#fff" }: AgentIconProps) {
  const s = size;

  switch (type) {
    // Claude Code: 终端光标 ">_"
    case "claude-code":
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
          <path d="M3 4L7 8L3 12" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9 12H13" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </svg>
      );

    // Codex: 花括号 "{}"
    case "codex":
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
          <path d="M5 2C3.5 2 3 3 3 4V6C3 7 2 7.5 2 8C2 8.5 3 9 3 10V12C3 13 3.5 14 5 14" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M11 2C12.5 2 13 3 13 4V6C13 7 14 7.5 14 8C14 8.5 13 9 13 10V12C13 13 12.5 14 11 14" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );

    // Cursor: 鼠标指针箭头
    case "cursor":
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
          <path d="M3 2L3 12L6 9L10 13L12 11L8 7L12 4Z" fill={color} opacity="0.9" />
        </svg>
      );

    // Antigravity: 向上的火箭/箭头
    case "antigravity":
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
          <path d="M8 2L8 11" stroke={color} strokeWidth="2" strokeLinecap="round" />
          <path d="M4 6L8 2L12 6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="5" cy="13" r="1.2" fill={color} opacity="0.5" />
          <circle cx="11" cy="13" r="1.2" fill={color} opacity="0.5" />
        </svg>
      );

    // Claude Desktop: 对话气泡
    case "claude-desktop":
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
          <path d="M3 3H13C13.5 3 14 3.5 14 4V10C14 10.5 13.5 11 13 11H9L6 14V11H3C2.5 11 2 10.5 2 10V4C2 3.5 2.5 3 3 3Z" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
          <circle cx="5.5" cy="7" r="0.8" fill={color} />
          <circle cx="8" cy="7" r="0.8" fill={color} />
          <circle cx="10.5" cy="7" r="0.8" fill={color} />
        </svg>
      );

    // OpenCode: 开源标记 "<>"
    case "opencode":
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
          <path d="M5 4L1 8L5 12" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M11 4L15 8L11 12" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9 3L7 13" stroke={color} strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
        </svg>
      );

    // Qwen Code: "Q" 标记
    case "qwen-code":
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="7.5" r="5" stroke={color} strokeWidth="1.5" />
          <path d="M10 10L13 13" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );

    // CodeBuddy: 握手/伙伴图标
    case "code-buddy":
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
          <path d="M2 8C4 6 6 6 8 8C10 6 12 6 14 8" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M4 11C6 9 10 9 12 11" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );

    // Windsurf: 帆/风帆
    case "windsurf":
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
          <path d="M8 2L8 14" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M8 2L13 8L8 8Z" fill={color} opacity="0.4" />
          <path d="M2 13L14 13" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );

    // Grok Build: stylized "G" / spark
    case "grok-build":
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="5.5" stroke={color} strokeWidth="1.5" />
          <path d="M10.5 8H8V5.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M11 3.5L12 2" stroke={color} strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
        </svg>
      );

    // 默认: 方块
    default:
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
          <rect x="2" y="2" width="12" height="12" rx="3" stroke={color} strokeWidth="1.5" />
          <path d="M5 8H11" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M8 5V11" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}

/** Agent accent colors — muted zinc palette, readable on near-black */
export function getAgentColor(type: AgentType): string {
  const colors: Record<AgentType, string> = {
    "claude-code": "#d4a574",
    codex: "#c4b5fd",
    cursor: "#94a3b8",
    antigravity: "#a78bfa",
    "claude-desktop": "#a8a29e",
    opencode: "#86efac",
    "qwen-code": "#7dd3fc",
    "code-buddy": "#fcd34d",
    windsurf: "#fca5a5",
    "grok-build": "#e4e4e7",
    gemini: "#60a5fa",
    zcode: "#c4b5fd",
    trae: "#f472b6",
    mimocode: "#34d399",
    droid: "#fb923c",
    qoder: "#a3e635",
    kimi: "#22d3ee",
    deepseek: "#818cf8",
    mistral: "#f97316",
    copilot: "#94a3b8",
    workbuddy: "#eab308",
    kiro: "#e879f9",
    hermes: "#2dd4bf",
    amp: "#f43f5e",
    "pi-agent": "#a78bfa",
    "oh-my-pi": "#c084fc",
    gajae: "#4ade80",
    unknown: "#71717a",
  };
  return colors[type] || "#71717a";
}

/** 获取 Agent 宿主的显示名称 */
export function getAgentLabel(type: AgentType): string {
  const labels: Record<AgentType, string> = {
    "claude-code": "Claude",
    codex: "Codex",
    cursor: "Cursor",
    antigravity: "Antigravity",
    "claude-desktop": "Claude App",
    opencode: "OpenCode",
    "qwen-code": "Qwen",
    "code-buddy": "CodeBuddy",
    windsurf: "Windsurf",
    "grok-build": "Grok Build",
    gemini: "Gemini",
    zcode: "ZCode",
    trae: "Trae",
    mimocode: "MiMo",
    droid: "Droid",
    qoder: "Qoder",
    kimi: "Kimi",
    deepseek: "DeepSeek",
    mistral: "Mistral",
    copilot: "Copilot",
    workbuddy: "WorkBuddy",
    kiro: "Kiro",
    hermes: "Hermes",
    amp: "Amp",
    "pi-agent": "Pi",
    "oh-my-pi": "Oh My Pi",
    gajae: "Gajae",
    unknown: "Agent",
  };
  return labels[type] || "Agent";
}
