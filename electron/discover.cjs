// Find agent sessions that are already running when Winsur starts.
// Hook configs are read at agent startup, so a Claude/Codex/Cursor process
// that was launched earlier will not emit SessionStart into a server that
// just came up. We still want a card immediately, and the next real hook
// event merges into it by agent type + cwd.

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const RECENT_ACTIVE_MS = 2 * 60 * 1000;
const CAP_PER_TYPE = 4;

const NAME_MAP = {
  windsurf: "windsurf",
  gemini: "gemini",
  qwen: "qwen-code",
  opencode: "opencode",
  kiro: "kiro",
  hermes: "hermes",
  trae: "trae",
  codebuddy: "code-buddy",
  antigravity: "antigravity",
  droid: "droid",
  kimi: "kimi",
  deepseek: "deepseek",
  amp: "amp",
  mistral: "mistral",
  vibe: "mistral",
  zcode: "zcode",
  qoder: "qoder",
  mimocode: "mimocode",
  workbuddy: "workbuddy",
  gajae: "gajae",
};

const LABELS = {
  "claude-code": "Claude",
  "claude-desktop": "Claude App",
  codex: "Codex",
  cursor: "Cursor",
  "grok-build": "Grok Build",
  windsurf: "Windsurf",
  gemini: "Gemini",
  "qwen-code": "Qwen",
  opencode: "OpenCode",
  kiro: "Kiro",
  hermes: "Hermes",
  trae: "Trae",
  "code-buddy": "CodeBuddy",
  antigravity: "Antigravity",
  droid: "Droid",
  kimi: "Kimi",
  deepseek: "DeepSeek",
  amp: "Amp",
  mistral: "Mistral",
  zcode: "ZCode",
  qoder: "Qoder",
  mimocode: "MiMo",
  workbuddy: "WorkBuddy",
  gajae: "Gajae",
};

function normCwd(cwd) {
  return String(cwd || "")
    .trim()
    .replace(/\//g, "\\")
    .replace(/\\+$/, "")
    .toLowerCase();
}

function baseName(cwd) {
  const parts = String(cwd || "").split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || "";
}

function isHelperProcess(proc) {
  const name = String(proc?.name || "").toLowerCase();
  const cmd = String(proc?.commandLine || "").toLowerCase();
  if (cmd.includes("--type=")) return true;
  if (name.includes("helper") || name.includes("crashpad") || name.includes("crashhandler")) {
    return true;
  }
  if (name.includes("gpu-process") || name.endsWith(" gpu") || name.includes("utility")) return true;
  return false;
}

/**
 * Map a Win32 process to an agent type. Returns null for unrelated processes
 * (editors' helper processes, plain node, browsers).
 */
function classifyProcess(proc) {
  if (!proc || isHelperProcess(proc)) return null;
  const name = String(proc.name || "")
    .replace(/\.exe$/i, "")
    .toLowerCase();
  const blob = `${proc.name || ""} ${proc.executablePath || ""} ${proc.commandLine || ""}`.toLowerCase();

  if (name === "cursor" || /[\\/]cursor\.exe(?:\s|"|$)/.test(blob)) return "cursor";
  if (name === "windsurf" || /[\\/]windsurf\.exe(?:\s|"|$)/.test(blob)) return "windsurf";

  if (
    name === "codex" ||
    /[\\/]codex\.exe(?:\s|"|$)/.test(blob) ||
    blob.includes("@openai/codex") ||
    blob.includes("@openai\\codex") ||
    blob.includes("codex-cli")
  ) {
    return "codex";
  }

  if (name === "grok" || /[\\/]grok\.exe(?:\s|"|$)/.test(blob)) return "grok-build";

  if (
    blob.includes("claude-code") ||
    blob.includes("@anthropic-ai") ||
    blob.includes("@anthropic-ai\\claude")
  ) {
    return "claude-code";
  }

  if (name === "claude") {
    if (blob.includes("anthropicclaude") || /[\\/]programs[\\/]claude[\\/]/.test(blob)) {
      return "claude-desktop";
    }
    return "claude-code";
  }

  if (name === "node" || name === "nodejs") {
    if (blob.includes("claude-code") || blob.includes("@anthropic-ai")) return "claude-code";
    if (blob.includes("@openai/codex") || blob.includes("codex-cli") || /[\\/]codex[\\/]/.test(blob)) {
      return "codex";
    }
    if (blob.includes("gemini-cli") || blob.includes("@google/gemini")) return "gemini";
    if (blob.includes("qwen-code") || blob.includes("@qwen")) return "qwen-code";
    return null;
  }

  if (NAME_MAP[name]) return NAME_MAP[name];
  return null;
}

function extractJsonString(text, key) {
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const m = String(text || "").match(re);
  if (!m) return "";
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return m[1];
  }
}

function extractCwd(text) {
  return (
    extractJsonString(text, "cwd") ||
    extractJsonString(text, "workspaceRoot") ||
    extractJsonString(text, "workspace_root") ||
    ""
  );
}

function readHead(file, bytes = 65536) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.slice(0, n).toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function mtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function fileUriToPath(uri) {
  const raw = String(uri || "");
  if (!raw) return "";
  if (!/^file:/i.test(raw)) return raw;
  try {
    const u = new URL(raw);
    let p = decodeURIComponent(u.pathname);
    if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
    return p;
  } catch {
    return "";
  }
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function collectClaude(home, out) {
  const root = path.join(home, ".claude", "projects");
  const ranked = [];
  for (const ent of listDirs(root)) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(root, ent.name);
    let best = null;
    for (const name of safeNames(dir)) {
      if (!/\.jsonl?$/i.test(name)) continue;
      const fp = path.join(dir, name);
      const m = mtime(fp);
      if (!best || m > best.m) best = { m, fp };
    }
    if (best) ranked.push(best);
  }
  ranked.sort((a, b) => b.m - a.m);
  for (const item of ranked.slice(0, 12)) {
    const cwd = extractCwd(readHead(item.fp));
    if (!cwd) continue;
    out.push({ agentType: "claude-code", cwd, mtime: item.m });
  }
}

function safeNames(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function walkFiles(root, { maxDepth, maxFiles, accept }) {
  const found = [];
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length && found.length < maxFiles) {
    const { dir, depth } = stack.pop();
    for (const ent of listDirs(dir)) {
      if (found.length >= maxFiles) break;
      if (ent.name === "node_modules" || ent.name === "cache" || ent.name === ".git") continue;
      const fp = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (depth < maxDepth) stack.push({ dir: fp, depth: depth + 1 });
      } else if (ent.isFile() && accept(ent.name)) {
        found.push(fp);
      }
    }
  }
  return found;
}

function collectJsonlCwds(root, agentType, out, maxDepth) {
  if (!root || !fs.existsSync(root)) return;
  const files = walkFiles(root, {
    maxDepth,
    maxFiles: 80,
    accept: (name) => /\.jsonl?$/i.test(name),
  });
  const ranked = files
    .map((fp) => ({ fp, m: mtime(fp) }))
    .sort((a, b) => b.m - a.m)
    .slice(0, 12);
  for (const item of ranked) {
    const cwd = extractCwd(readHead(item.fp));
    if (!cwd) continue;
    out.push({ agentType, cwd, mtime: item.m });
  }
}

function collectWorkspaceStorage(appdata, product, agentType, out) {
  if (!appdata) return;
  const root = path.join(appdata, product, "User", "workspaceStorage");
  const ranked = [];
  for (const ent of listDirs(root)) {
    if (!ent.isDirectory()) continue;
    const fp = path.join(root, ent.name, "workspace.json");
    if (!fs.existsSync(fp)) continue;
    ranked.push({ fp, m: mtime(fp) });
  }
  ranked.sort((a, b) => b.m - a.m);
  for (const item of ranked.slice(0, 12)) {
    let parsed = null;
    try {
      parsed = JSON.parse(fs.readFileSync(item.fp, "utf8"));
    } catch {
      parsed = null;
    }
    const cwd = fileUriToPath(parsed?.folder || parsed?.workspace || "");
    if (!cwd) continue;
    out.push({ agentType, cwd, mtime: item.m });
  }
}

function collectArtifacts({ home, appdata }) {
  const out = [];
  if (home) {
    collectClaude(home, out);
    collectJsonlCwds(path.join(home, ".codex", "sessions"), "codex", out, 4);
    collectJsonlCwds(path.join(home, ".grok"), "grok-build", out, 3);
    collectJsonlCwds(path.join(home, ".gemini"), "gemini", out, 3);
    collectJsonlCwds(path.join(home, ".hermes"), "hermes", out, 3);
  }
  collectWorkspaceStorage(appdata, "Cursor", "cursor", out);
  collectWorkspaceStorage(appdata, "Windsurf", "windsurf", out);
  return out;
}

function planDiscoveries({ processes, artifacts, now = Date.now() }) {
  const typed = [];
  for (const proc of processes || []) {
    const typeId = classifyProcess(proc);
    if (!typeId) continue;
    typed.push({ ...proc, typeId, pid: Number(proc.pid ?? proc.ProcessId) });
  }
  const types = new Set(typed.map((p) => p.typeId));
  const pids = new Set(typed.map((p) => p.pid).filter((n) => Number.isFinite(n) && n > 0));
  const sessions = [];
  const seen = new Set();

  for (const typeId of types) {
    const pid = typed.find((p) => p.typeId === typeId)?.pid || null;
    const arts = (artifacts || [])
      .filter((a) => a.agentType === typeId && a.cwd)
      .sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    const recent = arts.filter((a) => now - (a.mtime || 0) <= MAX_AGE_MS);
    const picked = (recent.length ? recent : arts.slice(0, 1)).slice(0, CAP_PER_TYPE);

    if (!picked.length) {
      sessions.push({
        id: `live:${typeId}:`,
        agent_type: typeId,
        cwd: "",
        name: LABELS[typeId] || typeId,
        pid,
        last_event_at: new Date(now).toISOString(),
        status: "idle",
      });
      continue;
    }

    for (const art of picked) {
      const key = `${typeId}|${normCwd(art.cwd)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const age = now - (art.mtime || 0);
      sessions.push({
        id: `live:${typeId}:${normCwd(art.cwd)}`,
        agent_type: typeId,
        cwd: art.cwd,
        name: baseName(art.cwd) || LABELS[typeId] || typeId,
        pid,
        last_event_at: new Date(art.mtime || now).toISOString(),
        status: age >= 0 && age < RECENT_ACTIVE_MS ? "thinking" : "idle",
      });
    }
  }

  return { sessions, pids, types };
}

function listProcesses() {
  if (process.platform !== "win32") return Promise.resolve(null);
  const script = `
$ErrorActionPreference = 'Stop'
$rows = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -match 'claude|codex|cursor|grok|windsurf|node|gemini|qwen|kiro|hermes|opencode|trae|codebuddy|antigravity|droid|kimi|deepseek|mistral|vibe|zcode|qoder|mimo|workbuddy|gajae|amp' -or
    ($_.CommandLine -and $_.CommandLine -match 'claude-code|@anthropic-ai|@openai/codex|codex-cli|gemini-cli|qwen-code')
  } |
  Select-Object ProcessId, Name, CommandLine, ExecutablePath
if (-not $rows) { '[]'; exit 0 }
$rows | ConvertTo-Json -Compress -Depth 4
`;
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: 12000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const text = String(stdout || "").trim();
        if (!text) {
          resolve([]);
          return;
        }
        try {
          const parsed = JSON.parse(text);
          const rows = Array.isArray(parsed) ? parsed : [parsed];
          resolve(
            rows.map((row) => ({
              pid: row.ProcessId,
              name: row.Name,
              commandLine: row.CommandLine,
              executablePath: row.ExecutablePath,
            }))
          );
        } catch {
          resolve(null);
        }
      }
    );
  });
}

/**
 * @returns {Promise<null | { sessions: object[], pids: Set<number>, types: Set<string> }>}
 * null when the process list could not be read (caller must not reap).
 */
async function scanRunningAgents() {
  const processes = await listProcesses();
  if (!processes) return null;
  let artifacts = [];
  try {
    artifacts = collectArtifacts({
      home: process.env.USERPROFILE || process.env.HOME || "",
      appdata: process.env.APPDATA || "",
    });
  } catch {
    artifacts = [];
  }
  return planDiscoveries({ processes, artifacts, now: Date.now() });
}

module.exports = {
  classifyProcess,
  isHelperProcess,
  planDiscoveries,
  collectArtifacts,
  extractCwd,
  fileUriToPath,
  scanRunningAgents,
  normCwd,
};
