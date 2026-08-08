// HTTP hook server — port of Rust server.rs (Express, no Rust)

const http = require("http");
const { SessionManager, normalizeHookPayload } = require("./agent.cjs");

const PORT = 18900;
const recentEvents = [];

/**
 * @param {{ onSessionUpdate: (session: object) => void, onNotify?: (type: string, title: string, body: string) => void }} callbacks
 */
function createHookServer(callbacks) {
  const sessionManager = new SessionManager();

  function pushLog(line) {
    recentEvents.push(line);
    if (recentEvents.length > 50) recentEvents.shift();
    console.log(`[HOOK] ${line}`);
  }

  function parseBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw) return resolve({});
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(e);
        }
      });
      req.on("error", reject);
    });
  }

  function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(body);
  }

  const server = http.createServer(async (req, res) => {
    // No CORS headers anywhere in here on purpose. Every real client is a
    // native HTTP caller (hook scripts, the agent's own http hook) that
    // ignores CORS, so allowing browser origins only lets any page you visit
    // read your open folders and pending prompts off localhost.
    const url = req.url || "/";

    if (req.method === "GET" && url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end("Winsur Hook Server OK");
    }

    if (req.method === "GET" && url === "/debug/events") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end(
        recentEvents.length
          ? recentEvents.join("\n")
          : "No events received yet.\nHooks configured? Check ~/.claude/settings.json"
      );
    }

    if (
      req.method === "GET" &&
      (url === "/agents" || url === "/hooks/sessions" || url === "/sessions")
    ) {
      return sendJson(res, 200, sessionManager.getSessions());
    }

    if (req.method === "POST" && (url === "/hooks/event" || url === "/hooks/permission")) {
      let payload;
      try {
        payload = await parseBody(req);
      } catch {
        return sendJson(res, 200, {});
      }

      // Normalize Grok camelCase + Claude snake_case into one shape
      const normalized = normalizeHookPayload(payload);
      const eventName = normalized.hook_event_name || payload.hook_event_name || payload.hookEventName || "?";
      const ntype = normalized.notification_type || payload.notification_type || payload.notificationType || "";
      const tool = normalized.tool_name || payload.tool_name || payload.toolName || "";
      const sid = normalized.session_id || payload.session_id || payload.sessionId || "?";
      const stamp = new Date().toLocaleTimeString();
      pushLog(`${stamp} | event=${eventName} ntype=${ntype} tool=${tool} sid=${sid}`);

      // This endpoint holds the tool call open, so the event has to raise a
      // permission card. Left as PreToolUse it would clear one instead.
      const handled =
        url === "/hooks/permission"
          ? { ...payload, hook_event_name: "PermissionRequest" }
          : payload;

      const session = sessionManager.handleEvent(handled);
      if (session) {
        callbacks.onSessionUpdate?.(session);

        const isPermission =
          eventName === "PermissionRequest" ||
          (eventName === "Notification" && ntype === "permission_prompt") ||
          url === "/hooks/permission";

        if (isPermission) {
          callbacks.onNotify?.("permission", session.name, tool || "needs permission");
        }
        if (eventName === "Stop" || eventName === "StopFailure") {
          callbacks.onNotify?.("done", session.name, "Agent finished");
        }
        // Toast "needs answer" ONLY when session actually has a required question after handling
        if (session.pending_question && session.status === "waiting") {
          callbacks.onNotify?.(
            "question",
            session.name,
            session.pending_question
          );
        }
      }

      // Blocking permission endpoint
      if (url === "/hooks/permission") {
        // Key on the card id the UI will answer with, not the raw hook session
        // id — one card can span several agent session ids.
        const sessionId = session?.id || payload.session_id;
        const decision = await sessionManager.waitPermission(sessionId, 300000);
        return sendJson(res, 200, {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: decision === "allow" ? "allow" : "deny",
            permissionDecisionReason:
              decision === "allow" ? "Allowed in Winsur" : "Denied in Winsur",
          },
        });
      }

      return sendJson(res, 200, {});
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  return {
    sessionManager,
    start() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(PORT, "127.0.0.1", () => {
          console.log(`Hook server: http://127.0.0.1:${PORT}`);
          resolve(PORT);
        });
      });
    },
    stop() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

module.exports = { createHookServer, PORT };
