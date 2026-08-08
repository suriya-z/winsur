// Local usage / quota readers (best-effort, fully local)

const fs = require("fs");
const path = require("path");

function home() {
  return process.env.USERPROFILE || process.env.HOME || "";
}

function safeReadJson(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function readText(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/**
 * @returns {Array<{ id: string, name: string, label: string, used: number|null, limit: number|null, remaining: number|null, resetsAt: string|null, detail: string, ok: boolean }>}
 */
function collectUsage() {
  const rows = [];

  // Claude Code — various local caches
  {
    const candidates = [
      path.join(home(), ".claude", "stats-cache.json"),
      path.join(home(), ".claude", "usage.json"),
      path.join(home(), ".claude", "session-env.json"),
    ];
    let found = null;
    for (const c of candidates) {
      const j = safeReadJson(c);
      if (j) {
        found = { path: c, data: j };
        break;
      }
    }
    if (found) {
      const d = found.data;
      const used = d.used ?? d.tokensUsed ?? d.five_hour?.used ?? null;
      const limit = d.limit ?? d.tokensLimit ?? d.five_hour?.limit ?? null;
      rows.push({
        id: "claude",
        name: "Claude",
        label: "Claude Code",
        used: typeof used === "number" ? used : null,
        limit: typeof limit === "number" ? limit : null,
        remaining:
          typeof used === "number" && typeof limit === "number"
            ? Math.max(0, limit - used)
            : null,
        resetsAt: d.resetsAt || d.reset_at || d.five_hour?.resetsAt || null,
        detail: found.path,
        ok: true,
      });
    } else {
      rows.push({
        id: "claude",
        name: "Claude",
        label: "Claude Code",
        used: null,
        limit: null,
        remaining: null,
        resetsAt: null,
        detail: "No local usage file (sign in / use Claude CLI first)",
        ok: false,
      });
    }
  }

  // Codex
  {
    const j =
      safeReadJson(path.join(home(), ".codex", "usage.json")) ||
      safeReadJson(path.join(home(), ".codex", "session.json"));
    if (j) {
      const used = j.used ?? j.primary_window?.used ?? null;
      const limit = j.limit ?? j.primary_window?.limit ?? null;
      rows.push({
        id: "codex",
        name: "Codex",
        label: "Codex CLI",
        used,
        limit,
        remaining:
          typeof used === "number" && typeof limit === "number"
            ? Math.max(0, limit - used)
            : null,
        resetsAt: j.resetsAt || j.primary_window?.resetsAt || null,
        detail: "local codex usage",
        ok: true,
      });
    } else {
      rows.push({
        id: "codex",
        name: "Codex",
        label: "Codex CLI",
        used: null,
        limit: null,
        remaining: null,
        resetsAt: null,
        detail: "No local Codex usage file",
        ok: false,
      });
    }
  }

  // Kimi / Moonshot
  {
    const j =
      safeReadJson(path.join(home(), ".kimi", "usage.json")) ||
      safeReadJson(path.join(home(), ".moonshot", "usage.json"));
    rows.push({
      id: "kimi",
      name: "Kimi",
      label: "Kimi Code",
      used: j?.used ?? null,
      limit: j?.limit ?? null,
      remaining: j && typeof j.used === "number" && typeof j.limit === "number" ? j.limit - j.used : null,
      resetsAt: j?.resetsAt || null,
      detail: j ? "local kimi usage" : "No local Kimi usage file",
      ok: !!j,
    });
  }

  // DeepSeek
  {
    const j = safeReadJson(path.join(home(), ".deepseek", "usage.json"));
    rows.push({
      id: "deepseek",
      name: "DeepSeek",
      label: "DeepSeek",
      used: j?.used ?? null,
      limit: j?.limit ?? null,
      remaining: j && typeof j.used === "number" && typeof j.limit === "number" ? j.limit - j.used : null,
      resetsAt: j?.resetsAt || null,
      detail: j ? "local deepseek usage" : "No local DeepSeek usage file",
      ok: !!j,
    });
  }

  // GLM (Zhipu)
  {
    const j =
      safeReadJson(path.join(home(), ".glm", "usage.json")) ||
      safeReadJson(path.join(home(), ".zhipu", "usage.json"));
    rows.push({
      id: "glm",
      name: "GLM",
      label: "GLM",
      used: j?.used ?? null,
      limit: j?.limit ?? null,
      remaining: j && typeof j.used === "number" && typeof j.limit === "number" ? j.limit - j.used : null,
      resetsAt: j?.resetsAt || null,
      detail: j ? "local glm usage" : "No local GLM usage file",
      ok: !!j,
    });
  }

  // Grok — no public local quota file usually
  {
    const auth = safeReadJson(path.join(home(), ".grok", "auth.json"));
    rows.push({
      id: "grok",
      name: "Grok",
      label: "Grok Build",
      used: null,
      limit: null,
      remaining: null,
      resetsAt: null,
      detail: auth ? "Signed in locally (quota not exposed in files)" : "Not signed in / no auth.json",
      ok: !!auth,
    });
  }

  return rows;
}

module.exports = { collectUsage };
