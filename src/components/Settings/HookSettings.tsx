// Hook 设置面板（紧凑版）
// 默认只显示一行摘要 + 按钮，点击展开宿主详情

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Download, Trash2, CheckCircle, XCircle, Loader, AlertCircle, ChevronDown } from "lucide-react";
import { installHooks, uninstallHooks, checkHooks } from "../../lib/tauri";

interface HostStatus {
  installed: boolean;
  detected: boolean;
  path: string | null;
}

interface AllHookStatus {
  [key: string]: HostStatus | string | null | undefined;
}

const HOST_CONFIG: { key: string; label: string; color: string }[] = [
  { key: "grok_build", label: "Grok Build", color: "#e4e4e7" },
  { key: "claude_code", label: "Claude Code", color: "#d4a574" },
  { key: "codex_cli", label: "Codex", color: "#c4b5fd" },
  { key: "claude_desktop", label: "Claude Desktop", color: "#a8a29e" },
  { key: "antigravity", label: "Antigravity", color: "#a78bfa" },
  { key: "opencode", label: "OpenCode", color: "#86efac" },
  { key: "qwen_code", label: "Qwen Code", color: "#7dd3fc" },
  { key: "codebuddy", label: "CodeBuddy", color: "#fcd34d" },
  { key: "windsurf", label: "Windsurf", color: "#fca5a5" },
];

export function HookSettings() {
  const [status, setStatus] = useState<AllHookStatus>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    checkHooks().then((s) => setStatus(s as AllHookStatus)).catch(() => {});
  }, []);

  const handleInstall = async () => {
    setLoading(true);
    setMessage("");
    try {
      const result = await installHooks();
      setMessage(result);
      const s = await checkHooks();
      setStatus(s as AllHookStatus);
    } catch (e) {
      setMessage(`Failed: ${e}`);
    }
    setLoading(false);
  };

  const handleUninstall = async () => {
    setLoading(true);
    setMessage("");
    try {
      const result = await uninstallHooks();
      setMessage(result);
      const s = await checkHooks();
      setStatus(s as AllHookStatus);
    } catch (e) {
      setMessage(`Failed: ${e}`);
    }
    setLoading(false);
  };

  // 统计
  const hosts = HOST_CONFIG.map(({ key }) => status[key] as HostStatus | undefined);
  const detected = hosts.filter((h) => h?.detected).length;
  const installed = hosts.filter((h) => h?.installed).length;

  return (
    <div style={{ padding: "6px 12px" }}>
      {/* 一行摘要：数量 + 按钮 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {/* 摘要文字（可点击展开详情） */}
        <motion.button
          className="no-drag"
          onClick={() => setShowDetail(!showDetail)}
          whileHover={{ backgroundColor: "rgba(255,255,255,0.04)" }}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontSize: 10.5,
            color: "var(--text-muted)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: "2px 4px",
            borderRadius: 4,
            textAlign: "left",
          }}
        >
          <span style={{ color: installed > 0 ? "var(--accent-green)" : "var(--accent-yellow)" }}>
            {installed > 0 ? `${installed} connected` : detected > 0 ? `${detected} detected` : "No agents"}
          </span>
          <span style={{ opacity: 0.4 }}>/</span>
          <span>{HOST_CONFIG.length} hosts</span>
          <ChevronDown
            size={10}
            style={{
              opacity: 0.4,
              transform: showDetail ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s",
            }}
          />
        </motion.button>

        {/* Install 按钮 */}
        <motion.button
          className="no-drag"
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          onClick={handleInstall}
          disabled={loading}
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid var(--border-default)",
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
            fontSize: 10,
            fontWeight: 600,
            cursor: loading ? "wait" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: 3,
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? <Loader size={9} className="spin" /> : <Download size={9} />}
          Install
        </motion.button>

        {/* Uninstall */}
        <motion.button
          className="no-drag"
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          onClick={handleUninstall}
          disabled={loading}
          style={{
            padding: "4px 6px",
            borderRadius: 6,
            border: "1px solid var(--border-subtle)",
            background: "var(--bg-card)",
            color: "var(--accent-red)",
            fontSize: 10,
            cursor: loading ? "wait" : "pointer",
            display: "flex",
            alignItems: "center",
            opacity: loading ? 0.6 : 1,
          }}
        >
          <Trash2 size={9} />
        </motion.button>
      </div>

      {/* 可展开的宿主详情 */}
      <AnimatePresence>
        {showDetail && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: "hidden" }}
          >
            <div style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "3px 6px",
              paddingTop: 6,
            }}>
              {HOST_CONFIG.map(({ key, label, color: hostColor }) => {
                const h = status[key] as HostStatus | undefined;
                const detected = h?.detected ?? false;
                const installed = h?.installed ?? false;
                // 检测到的用宿主自身颜色，未检测到的灰色
                const displayColor = !detected ? "#52525b" : hostColor;
                const opacity = !detected ? 0.4 : installed ? 1 : 0.7;
                const Icon = !detected ? XCircle : installed ? CheckCircle : AlertCircle;
                return (
                  <span
                    key={key}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                      fontSize: 9.5,
                      color: displayColor,
                      opacity,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: `color-mix(in srgb, ${displayColor} 10%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${displayColor} 20%, transparent)`,
                    }}
                  >
                    <Icon size={8} />
                    {label}
                  </span>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 消息 */}
      {message && (
        <div style={{
          fontSize: 9,
          color: "var(--text-muted)",
          marginTop: 4,
          padding: "2px 6px",
          background: "rgba(255,255,255,0.03)",
          borderRadius: 4,
          whiteSpace: "pre-line",
        }}>
          {message}
        </div>
      )}
    </div>
  );
}
