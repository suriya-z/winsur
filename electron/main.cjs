// Electron main process — Winsur (no Rust / no C++ toolchain)

const { app, BrowserWindow, Tray, Menu, nativeImage, Notification, ipcMain, screen, shell } = require("electron");
const path = require("path");
const { createHookServer } = require("./server.cjs");
const { installAllHooks, uninstallAllHooks, checkHooksStatus, autoInstallOnLaunch } = require("./hooks.cjs");
const { focusTerminal, sendTextToWindow } = require("./window.cjs");
const { collectUsage } = require("./usage.cjs");
const sshRemote = require("./ssh-remote.cjs");
const { guardNavigation } = require("./navigation.cjs");
const fs = require("fs");

const isDev = !app.isPackaged;
const DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:1420";

let mainWindow = null;
let tray = null;
let hookServer = null;

// ── Single instance: second launch focuses the first (prevents dual hook servers) ──
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.setAlwaysOnTop(true, "screen-saver");
      mainWindow.focus();
    }
  });
}

if (process.platform === "win32") {
  app.setAppUserModelId("com.winsur.app");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Winsur is always-on-top transparent — it blocks SetForegroundWindow / SendInput
 * to the agent terminal. Fully hide for the duration of jump/send.
 */
async function releaseIslandForInput() {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(false);
      mainWindow.setIgnoreMouseEvents(true);
      mainWindow.hide();
      mainWindow.blur();
    }
  } catch {
    /* ignore */
  }
  await sleep(220);
}

async function restoreIsland({ focus = true } = {}) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
      mainWindow.setAlwaysOnTop(true, "screen-saver");
      if (focus) {
        mainWindow.show();
        mainWindow.focus();
      } else {
        // keep floating but don't steal FG from agent (jump success)
        mainWindow.showInactive?.() || mainWindow.show();
      }
    }
  } catch {
    /* ignore */
  }
}

function createWindow() {
  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;
  const winW = 500;
  const winH = 600;
  const x = Math.round((screenW - winW) / 2);
  const y = 8;

  mainWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
    title: "Winsur",
  });

  console.log(`[Winsur] createWindow: x=${x}, y=${y}, winW=${winW}, winH=${winH}, DEV_URL=${DEV_URL}, isDev=${isDev}`);

  try {
    mainWindow.setAlwaysOnTop(true, "screen-saver");
  } catch {
    try { mainWindow.setAlwaysOnTop(true); } catch {}
  }
  try {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {}

  guardNavigation(mainWindow.webContents, (url) => {
    shell.openExternal(url).catch(() => {});
  });

  mainWindow.webContents.on("did-finish-load", () => {
    console.log("[Winsur] webContents did-finish-load");
  });
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`[Winsur] webContents did-fail-load (${code}): ${desc} -> ${url}`);
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error("[Winsur] renderer gone:", details);
  });
  mainWindow.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    console.log(`[Renderer ${level}] ${message} (${sourceId}:${line})`);
  });

  const distHtml = path.join(__dirname, "..", "dist", "index.html");
  if (isDev) {
    mainWindow.loadURL(DEV_URL).catch(() => {
      if (mainWindow && !mainWindow.isDestroyed() && fs.existsSync(distHtml)) {
        console.log("[Winsur] Dev server unavailable -> falling back to dist/index.html");
        mainWindow.loadFile(distHtml).catch(() => {});
      }
    });
  } else {
    mainWindow.loadFile(distHtml);
  }

  // Pass clicks through transparent background around the capsule by default
  try {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  } catch {}

  mainWindow.once("ready-to-show", () => {
    console.log("[Winsur] ready-to-show fired -> showing window");
    mainWindow.show();
    mainWindow.focus();
  });

  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.log("[Winsur] Fallback timeout -> forcing mainWindow.show()");
      mainWindow.show();
      mainWindow.focus();
    }
  }, 2000);

  mainWindow.on("show", () => {
    console.log("[Winsur] mainWindow 'show' event fired! Visible:", mainWindow.isVisible());
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createTray() {
  let icon = nativeImage.createEmpty();
  const candidates = [
    path.join(__dirname, "..", "assets", "icons", "icon.ico"),
    path.join(__dirname, "..", "assets", "icons", "32x32.png"),
    path.join(__dirname, "..", "build", "icon.ico"),
    path.join(__dirname, "..", "build", "icon.png"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const loaded = nativeImage.createFromPath(p);
        if (!loaded.isEmpty()) {
          icon = loaded.resize({ width: 16, height: 16 });
          break;
        }
      }
    } catch {
      /* ignore */
    }
  }
  if (icon.isEmpty()) {
    icon = nativeImage.createFromDataURL(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFUlEQVQ4T2NkYGD4z0ABYBw1gGE0DAB9iAABfuXzWQAAAABJRU5ErkJggg=="
    );
  }

  try {
    tray = new Tray(icon);
    const menu = Menu.buildFromTemplate([
      {
        label: "Show / Hide",
        click: () => {
          if (!mainWindow) return;
          if (mainWindow.isVisible()) mainWindow.hide();
          else {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setToolTip("Winsur");
    tray.setContextMenu(menu);
    tray.on("click", () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible()) mainWindow.hide();
      else {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (e) {
    console.warn("[Winsur] Tray creation warning:", e.message || e);
  }
}

function notify(title, body) {
  if (!Notification.isSupported()) return;
  new Notification({ title, body }).show();
}

function wireIpc(sessionManager) {
  ipcMain.handle("vibe:invoke", async (_event, { cmd, args }) => {
    switch (cmd) {
      case "get_agents":
        return sessionManager.getSessions();

      case "clear_agents":
        sessionManager.clearAll();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("agents-cleared", []);
          mainWindow.webContents.send("agents-sync", []);
        }
        return [];

      case "respond_permission": {
        const ok = sessionManager.respondPermission(args.sessionId, args.decision);
        const session = sessionManager.getSessions().find((s) => s.id === args.sessionId);
        if (session && mainWindow) {
          mainWindow.webContents.send("agent-update", session);
          mainWindow.webContents.send("agents-sync", sessionManager.getSessions());
        }
        return ok;
      }

      case "focus_terminal": {
        const session = sessionManager.findSession(args.sessionId);
        if (!session) return { ok: false, detail: "session not found" };

        await releaseIslandForInput();

        let result = { ok: false, detail: "jump failed" };
        try {
          const r = await focusTerminal(session.cwd, session.name, session.agent_type);
          if (typeof r === "boolean") result = { ok: r, detail: r ? "ok" : "failed" };
          else result = r || result;
        } catch (e) {
          console.warn("[focus_terminal]", e);
          result = { ok: false, detail: e.message || String(e) };
        }

        // Success: leave agent focused. Failure: bring Winsur back.
        await restoreIsland({ focus: !result.ok });

        if (!result.ok) {
          const d = result.detail || "";
          let msg = "Could not find agent terminal window";
          if (d.includes("AGENT_EXITED")) {
            msg =
              "Agent process already exited — the terminal tab often closes with it. Start the agent again, then jump.";
          } else if (d.includes("NO_WINDOW")) {
            msg = "Agent may still be running, but no matching window was found.";
          } else if (d.includes("NO_FOCUS")) {
            msg = "Found the terminal but could not bring it to the front.";
          }
          notify("Jump failed", msg);
        }
        return { ok: !!result.ok, detail: result.detail || "" };
      }

      case "get_settings": {
        const p = path.join(process.env.USERPROFILE || "", ".winsur", "settings.json");
        const defaults = {
          httpPort: 18900,
          soundEnabled: true,
          soundVolume: 80,
          autoStart: false,
          theme: "dark",
        };
        try {
          if (fs.existsSync(p)) return { ...defaults, ...JSON.parse(fs.readFileSync(p, "utf8")) };
        } catch {
          /* ignore */
        }
        return defaults;
      }

      case "save_settings": {
        const dir = path.join(process.env.USERPROFILE || "", ".winsur");
        fs.mkdirSync(dir, { recursive: true });
        const p = path.join(dir, "settings.json");
        let cur = {};
        try {
          if (fs.existsSync(p)) cur = JSON.parse(fs.readFileSync(p, "utf8"));
        } catch {
          /* ignore */
        }
        const next = { ...cur, ...(args || {}) };
        fs.writeFileSync(p, JSON.stringify(next, null, 2), "utf8");
        return next;
      }

      case "get_usage":
        return collectUsage();

      case "ssh_list":
        return sshRemote.listRemotes();
      case "ssh_connect":
        return sshRemote.connectRemote(args.id);
      case "ssh_disconnect":
        return sshRemote.disconnectRemote(args.id);
      case "ssh_add":
        return sshRemote.addRemote(args || {});
      case "ssh_remove":
        return sshRemote.removeRemote(args.id);
      case "ssh_deploy_script":
        return sshRemote.getRemoteDeployScript();

      case "respond_plan": {
        const session = sessionManager.findSession(args.sessionId);
        if (!session) return { ok: false, detail: "session not found" };
        const decision = args.decision;
        let message = args.message || "";
        if (decision === "approve") message = message || "Plan approved. Proceed.";
        else if (decision === "feedback") message = message || "Please revise the plan.";

        await releaseIslandForInput();
        let result = { ok: false, detail: "send failed" };
        try {
          result = await sendTextToWindow(
            session.cwd,
            session.name,
            session.agent_type,
            message
          );
        } catch (e) {
          result = { ok: false, detail: e.message || String(e) };
        }
        await sleep(120);
        await restoreIsland({ focus: true });

        if (result.ok) sessionManager.clearPlan(session.id);
        const updated = sessionManager.getSessions().find((s) => s.id === session.id);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("agents-sync", sessionManager.getSessions());
          if (updated) mainWindow.webContents.send("agent-update", updated);
        }
        if (!result.ok) {
          notify("Plan reply failed", result.detail || "Could not paste into terminal");
        }
        return { ok: !!result.ok, detail: result.detail || "" };
      }

      case "dismiss_plan": {
        sessionManager.clearPlan(args.sessionId);
        const updated = sessionManager.getSessions().find((s) => s.id === args.sessionId);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("agents-sync", sessionManager.getSessions());
          if (updated) mainWindow.webContents.send("agent-update", updated);
        }
        return true;
      }

      case "dismiss_agent":
        sessionManager.removeSession(args.sessionId);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("agents-sync", sessionManager.getSessions());
        }
        return null;

      case "reply_question": {
        const session = sessionManager.findSession(args.sessionId);
        if (!session) return { ok: false, detail: "no active agent session" };

        const msg = String(args.message || "").trim();
        if (!msg) return { ok: false, detail: "empty message" };

        // Hide Winsur completely so paste cannot land on us
        await releaseIslandForInput();

        let result = { ok: false, detail: "send failed", background: false };
        try {
          result = await sendTextToWindow(
            session.cwd,
            session.name,
            session.agent_type,
            msg
          );
        } catch (e) {
          result = { ok: false, detail: e.message || String(e), background: false };
        }

        // Let terminal process Enter before we steal FG back
        await sleep(200);
        await restoreIsland({ focus: true });

        if (result.ok) {
          sessionManager.clearQuestion(session.id);
          const s = sessionManager.getSessions().find((a) => a.id === session.id);
          if (s) {
            s.status = "thinking";
            s.last_tool = "reply sent";
            s.pending_question = null;
            sessionManager.scheduleIdle?.(session.id);
          }
          notify("Reply sent", "Message pasted into agent terminal");
        } else {
          notify(
            "Reply failed",
            (result.detail || "Could not paste").slice(0, 180)
          );
          console.warn("[reply_question]", result.detail);
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("agents-sync", sessionManager.getSessions());
        }
        return {
          ok: !!result.ok,
          detail: result.detail || "",
          background: false,
        };
      }

      case "install_hooks":
        return installAllHooks();

      case "uninstall_hooks":
        return uninstallAllHooks();

      case "check_hooks":
        return checkHooksStatus();

      default:
        throw new Error(`Unknown command: ${cmd}`);
    }
  });

  let dragState = null;
  let dragTimer = null;
  let dragSafety = null;

  function stopWindowDrag() {
    dragState = null;
    if (dragTimer) {
      clearInterval(dragTimer);
      dragTimer = null;
    }
    if (dragSafety) {
      clearTimeout(dragSafety);
      dragSafety = null;
    }
  }

  function startDrag() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    stopWindowDrag();

    const point = screen.getCursorScreenPoint();
    const bounds = mainWindow.getBounds();
    dragState = {
      offsetX: point.x - bounds.x,
      offsetY: point.y - bounds.y,
    };

    dragTimer = setInterval(() => {
      if (!dragState || !mainWindow || mainWindow.isDestroyed()) {
        stopWindowDrag();
        return;
      }
      const p = screen.getCursorScreenPoint();
      mainWindow.setPosition(
        Math.round(p.x - dragState.offsetX),
        Math.round(p.y - dragState.offsetY)
      );
    }, 8);

    dragSafety = setTimeout(stopWindowDrag, 15000);
  }

  ipcMain.on("winsur:start-dragging", () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setIgnoreMouseEvents(false);
      }
    } catch {}
    startDrag();
  });
  ipcMain.on("vibe:start-dragging", startDrag);
  ipcMain.on("winsur:stop-dragging", stopWindowDrag);
  ipcMain.on("vibe:stop-dragging", stopWindowDrag);
  ipcMain.on("winsur:set-ignore-mouse-events", (_event, { ignore, forward = true } = {}) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed() && !dragState) {
        if (ignore) {
          mainWindow.setIgnoreMouseEvents(true, { forward: !!forward });
        } else {
          mainWindow.setIgnoreMouseEvents(false);
        }
      }
    } catch {}
  });
}

if (gotLock) {
  app.whenReady().then(async () => {
    hookServer = createHookServer({
      onSessionUpdate: (session) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("agents-sync", hookServer.sessionManager.getSessions());
          mainWindow.webContents.send("agent-update", session);
        }
      },
      onNotify: (type, title, body) => {
        if (type === "permission") notify(`Permission — ${title}`, body);
        else if (type === "done") notify(`Done — ${title}`, body);
        else if (type === "question") notify(`Question — ${title}`, body);
      },
    });

    hookServer.sessionManager.setIdleCallback((session) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("agents-sync", hookServer.sessionManager.getSessions());
        mainWindow.webContents.send("agent-update", session);
      }
    });

    try {
      await hookServer.start();
    } catch (err) {
      console.error("Hook server failed to start (port 18900 busy?):", err.message);
      // Still show UI — user can free port / restart
    }

    hookServer.sessionManager.clearAll();
    // Always rewrite Grok hooks to HTTP-only (kills dual HTTP+PS1 double cards)
    autoInstallOnLaunch();

    try {
      console.log("[Winsur] Wiring IPC...");
      wireIpc(hookServer.sessionManager);
      console.log("[Winsur] Creating window...");
      createWindow();
      console.log("[Winsur] Creating tray...");
      createTray();
      console.log("[Winsur] Setup completed.");
    } catch (e) {
      console.error("[Winsur] Setup error:", e);
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && app.isQuitting) {
      app.quit();
    }
  });

  app.on("before-quit", async () => {
    app.isQuitting = true;
    try {
      sshRemote.disconnectAll();
    } catch {
      /* ignore */
    }
    if (hookServer) await hookServer.stop();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
