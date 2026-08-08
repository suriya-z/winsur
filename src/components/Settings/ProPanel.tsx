// Zero-config agents + usage + SSH + sounds — pro control panel

import { useEffect, useState, type CSSProperties } from "react";
import { motion } from "motion/react";
import {
  checkHooks,
  installHooks,
  getUsage,
  getSettings,
  saveSettings,
  sshList,
  sshConnect,
  sshDisconnect,
  sshAdd,
  sshRemove,
} from "../../lib/bridge";
import { setSoundEnabled, setSoundVolume, playSound } from "../../lib/sounds";
import type { UsageRow, SshRemote, Settings } from "../../types/agent";

type Tab = "agents" | "usage" | "ssh" | "sound";

export function ProPanel() {
  const [tab, setTab] = useState<Tab>("agents");
  const [hooks, setHooks] = useState<Record<string, unknown>>({});
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [remotes, setRemotes] = useState<SshRemote[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [msg, setMsg] = useState("");
  const [hostInput, setHostInput] = useState("");
  const [nameInput, setNameInput] = useState("");

  const refresh = async () => {
    try {
      setHooks(await checkHooks());
      setUsage(await getUsage());
      setRemotes(await sshList());
      const s = await getSettings();
      setSettings(s);
      setSoundEnabled(s.soundEnabled);
      setSoundVolume(s.soundVolume);
    } catch (e) {
      setMsg(String(e));
    }
  };

  useEffect(() => {
    void refresh();
    const t = setInterval(() => {
      if (tab === "usage") void getUsage().then(setUsage);
      if (tab === "ssh") void sshList().then(setRemotes);
    }, 8000);
    return () => clearInterval(t);
  }, [tab]);

  const agentEntries = Object.entries(hooks).filter(
    ([k, v]) => k !== "hook_script" && k !== "agent_count" && v && typeof v === "object"
  ) as [string, { name?: string; detected?: boolean; installed?: boolean }][];

  const tabs: { id: Tab; label: string }[] = [
    { id: "agents", label: "Agents" },
    { id: "usage", label: "Usage" },
    { id: "ssh", label: "SSH" },
    { id: "sound", label: "Sound" },
  ];

  return (
    <div style={{ padding: "4px 10px 10px" }} className="no-drag">
      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              padding: "3px 8px",
              borderRadius: 6,
              border: "1px solid var(--border-subtle)",
              background: tab === t.id ? "rgba(255,255,255,0.1)" : "transparent",
              color: tab === t.id ? "var(--text-primary)" : "var(--text-muted)",
              fontSize: 10,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "agents" && (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
            <span style={{ fontSize: 10.5, color: "var(--text-muted)", flex: 1 }}>
              {agentEntries.filter(([, v]) => v.installed).length}/
              {agentEntries.length} hooked · zero-config on launch
            </span>
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={async () => {
                setMsg("Installing…");
                try {
                  setMsg(await installHooks());
                  await refresh();
                  playSound("done");
                } catch (e) {
                  setMsg(String(e));
                }
              }}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: "1px solid var(--border-default)",
                background: "var(--bg-elevated)",
                color: "var(--text-primary)",
                fontSize: 10,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Install all
            </motion.button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxHeight: 140, overflowY: "auto" }}>
            {agentEntries.map(([key, v]) => (
              <span
                key={key}
                style={{
                  fontSize: 9.5,
                  padding: "2px 6px",
                  borderRadius: 4,
                  border: "1px solid var(--border-subtle)",
                  color: v.installed
                    ? "var(--accent-green)"
                    : v.detected
                    ? "var(--accent-yellow)"
                    : "var(--text-muted)",
                  opacity: v.detected || v.installed ? 1 : 0.45,
                }}
                title={key}
              >
                {v.name || key}
              </span>
            ))}
          </div>
        </div>
      )}

      {tab === "usage" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 160, overflowY: "auto" }}>
          {usage.map((u) => (
            <div
              key={u.id}
              style={{
                padding: "6px 8px",
                borderRadius: 8,
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{u.label}</span>
                <span style={{ color: u.ok ? "var(--accent-green)" : "var(--text-muted)", fontSize: 10 }}>
                  {u.remaining != null && u.limit != null
                    ? `${u.remaining} / ${u.limit} left`
                    : u.ok
                    ? "active"
                    : "n/a"}
                </span>
              </div>
              {u.limit != null && u.used != null && (
                <div
                  style={{
                    marginTop: 4,
                    height: 3,
                    borderRadius: 2,
                    background: "rgba(255,255,255,0.06)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, (u.used / u.limit) * 100)}%`,
                      height: "100%",
                      background: "var(--accent-blue)",
                    }}
                  />
                </div>
              )}
              <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 3 }}>{u.detail}</div>
            </div>
          ))}
        </div>
      )}

      {tab === "ssh" && (
        <div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6, lineHeight: 1.4 }}>
            Reverse tunnel: remote agents → your island (local only). Needs OpenSSH client.
          </div>
          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            <input
              placeholder="name"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              style={inputStyle}
            />
            <input
              placeholder="user@host"
              value={hostInput}
              onChange={(e) => setHostInput(e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              type="button"
              onClick={async () => {
                if (!hostInput.trim()) return;
                setRemotes(
                  await sshAdd({ name: nameInput || hostInput, host: hostInput.trim() })
                );
                setHostInput("");
                setNameInput("");
              }}
              style={btnStyle}
            >
              Add
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 120, overflowY: "auto" }}>
            {remotes.map((r) => (
              <div
                key={r.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 10.5,
                  padding: "4px 6px",
                  borderRadius: 6,
                  background: "var(--bg-elevated)",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: r.connected ? "var(--accent-green)" : "var(--text-muted)",
                  }}
                />
                <span style={{ flex: 1, color: "var(--text-secondary)" }}>
                  {r.name} · {r.host}
                </span>
                {r.connected ? (
                  <button type="button" style={btnStyle} onClick={() => sshDisconnect(r.id).then(() => refresh())}>
                    Stop
                  </button>
                ) : (
                  <button type="button" style={btnStyle} onClick={() => sshConnect(r.id).then(() => refresh())}>
                    Connect
                  </button>
                )}
                <button type="button" style={btnStyle} onClick={() => sshRemove(r.id).then(setRemotes)}>
                  ✕
                </button>
              </div>
            ))}
            {!remotes.length && (
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>No remotes yet</div>
            )}
          </div>
        </div>
      )}

      {tab === "sound" && settings && (
        <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={settings.soundEnabled}
              onChange={async (e) => {
                const s = await saveSettings({ soundEnabled: e.target.checked });
                setSettings(s);
                setSoundEnabled(s.soundEnabled);
              }}
            />
            Sound alerts (8-bit)
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Volume</span>
            <input
              type="range"
              min={0}
              max={100}
              value={settings.soundVolume}
              onChange={async (e) => {
                const v = Number(e.target.value);
                setSoundVolume(v);
                const s = await saveSettings({ soundVolume: v });
                setSettings(s);
              }}
              style={{ flex: 1 }}
            />
          </div>
          <button
            type="button"
            style={btnStyle}
            onClick={() => {
              playSound("done");
              playSound("permission");
            }}
          >
            Preview sounds
          </button>
          <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.4 }}>
            Custom packs later: place wav files in ~/.winsur/sounds/
          </div>
        </div>
      )}

      {msg && (
        <div style={{ marginTop: 8, fontSize: 9.5, color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>
          {msg}
        </div>
      )}
    </div>
  );
}

const inputStyle: CSSProperties = {
  padding: "4px 6px",
  borderRadius: 6,
  border: "1px solid var(--border-default)",
  background: "var(--bg-inset)",
  color: "var(--text-primary)",
  fontSize: 10,
  width: 72,
};

const btnStyle: CSSProperties = {
  padding: "3px 8px",
  borderRadius: 6,
  border: "1px solid var(--border-default)",
  background: "var(--bg-elevated)",
  color: "var(--text-secondary)",
  fontSize: 10,
  cursor: "pointer",
};
