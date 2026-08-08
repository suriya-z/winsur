// SSH remote agent monitoring — fully local, user-controlled tunnels

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const CONFIG_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".winsur"
);
const CONFIG_PATH = path.join(CONFIG_DIR, "ssh-remotes.json");

/** @type {Map<string, import('child_process').ChildProcess>} */
const tunnels = new Map();

function ensureConfig() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify(
        {
          remotes: [
            // Example:
            // { id: "lab", name: "Lab Server", host: "user@10.0.0.5", remotePort: 18900, localPort: 18901, enabled: false }
          ],
        },
        null,
        2
      ),
      "utf8"
    );
  }
}

function loadRemotes() {
  ensureConfig();
  try {
    const j = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return Array.isArray(j.remotes) ? j.remotes : [];
  } catch {
    return [];
  }
}

function saveRemotes(remotes) {
  ensureConfig();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ remotes }, null, 2), "utf8");
}

function listRemotes() {
  const remotes = loadRemotes();
  return remotes.map((r) => ({
    ...r,
    connected: tunnels.has(r.id) && !tunnels.get(r.id)?.killed,
  }));
}

/**
 * Reverse tunnel: remote agents POST to remotePort → forwarded to local 18900
 * ssh -N -R remotePort:127.0.0.1:18900 user@host
 */
function connectRemote(id) {
  const remotes = loadRemotes();
  const r = remotes.find((x) => x.id === id);
  if (!r) throw new Error("Remote not found");
  if (tunnels.has(id)) return { ok: true, detail: "already connected" };

  const remotePort = r.remotePort || 18900;
  const args = [
    "-N",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "ExitOnForwardFailure=yes",
    "-R",
    `${remotePort}:127.0.0.1:18900`,
    r.host,
  ];

  const child = spawn("ssh", args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  tunnels.set(id, child);
  child.on("exit", () => {
    tunnels.delete(id);
  });
  child.stderr?.on("data", (d) => {
    console.log(`[ssh:${id}]`, String(d).trim());
  });

  return { ok: true, detail: `tunnel ${r.host} -R ${remotePort}:localhost:18900` };
}

function disconnectRemote(id) {
  const child = tunnels.get(id);
  if (child) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    tunnels.delete(id);
  }
  return { ok: true };
}

function disconnectAll() {
  for (const id of [...tunnels.keys()]) disconnectRemote(id);
}

function addRemote(remote) {
  const remotes = loadRemotes();
  const id =
    remote.id ||
    String(remote.name || remote.host || "remote")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 32);
  const row = {
    id,
    name: remote.name || id,
    host: remote.host,
    remotePort: remote.remotePort || 18900,
    enabled: !!remote.enabled,
  };
  const idx = remotes.findIndex((x) => x.id === id);
  if (idx >= 0) remotes[idx] = { ...remotes[idx], ...row };
  else remotes.push(row);
  saveRemotes(remotes);
  return listRemotes();
}

function removeRemote(id) {
  disconnectRemote(id);
  saveRemotes(loadRemotes().filter((x) => x.id !== id));
  return listRemotes();
}

/** One-click deploy helper script content for remote host */
function getRemoteDeployScript() {
  return `#!/usr/bin/env bash
# Run on the REMOTE machine where agents live.
# Point agent hooks at: http://127.0.0.1:18900/hooks/event
# Then from your Windows PC, connect this host in Winsur SSH panel
# (reverse tunnel publishes remote :18900 to your local Winsur).
echo "Configure agent hooks to http://127.0.0.1:18900/hooks/event"
echo "Keep SSH reverse tunnel connected from Winsur."
`;
}

module.exports = {
  listRemotes,
  connectRemote,
  disconnectRemote,
  disconnectAll,
  addRemote,
  removeRemote,
  getRemoteDeployScript,
  CONFIG_PATH,
};
