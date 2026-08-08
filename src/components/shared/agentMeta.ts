// Agent display metadata. Kept out of AgentIcon.tsx so that file exports only
// components — mixing the two breaks Vite fast refresh.

import type { AgentType } from "../../types/agent";

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
