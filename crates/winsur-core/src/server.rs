//! Loopback hook server. No CORS headers: browser pages must not read it.
//! Each request runs on its own thread so a permission wait cannot stall the
//! accept loop.

use std::io::{Cursor, Read};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde_json::{json, Value};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

use crate::agent::SessionManager;

const PORT: u16 = 18900;

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("header")
}

type NotifyFn = dyn Fn(&str, &str, &str) + Send + Sync;

fn text(status: u16, body: &str, content_type: &str) -> Response<Cursor<Vec<u8>>> {
    Response::from_data(body.as_bytes().to_vec())
        .with_status_code(StatusCode(status))
        .with_header(header("Content-Type", content_type))
}

pub struct HookServer {
    shutdown: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl HookServer {
    pub fn start(
        sessions: Arc<SessionManager>,
        on_update: Arc<dyn Fn(Value) + Send + Sync>,
        on_notify: Arc<NotifyFn>,
    ) -> Result<Self, String> {
        let server = Server::http(format!("127.0.0.1:{PORT}")).map_err(|e| e.to_string())?;
        let shutdown = Arc::new(AtomicBool::new(false));
        let flag = shutdown.clone();
        let recent = Arc::new(Mutex::new(Vec::<String>::new()));
        let thread = thread::spawn(move || {
            eprintln!("Hook server: http://127.0.0.1:{PORT}");
            loop {
                if flag.load(Ordering::SeqCst) {
                    break;
                }
                let request = match server.recv_timeout(Duration::from_millis(200)) {
                    Ok(Some(req)) => req,
                    _ => continue,
                };
                let sessions = sessions.clone();
                let on_update = on_update.clone();
                let on_notify = on_notify.clone();
                let recent = recent.clone();
                thread::spawn(move || handle(request, sessions, on_update, on_notify, recent));
            }
        });
        Ok(Self {
            shutdown,
            thread: Some(thread),
        })
    }

    pub fn stop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for HookServer {
    fn drop(&mut self) {
        self.stop();
    }
}

fn handle(
    mut request: Request,
    sessions: Arc<SessionManager>,
    on_update: Arc<dyn Fn(Value) + Send + Sync>,
    on_notify: Arc<NotifyFn>,
    recent: Arc<Mutex<Vec<String>>>,
) {
    let url = request.url().split('?').next().unwrap_or("/").to_string();
    let method = request.method().clone();
    if method == Method::Get && url == "/health" {
        let _ = request.respond(text(200, "Winsur Hook Server OK", "text/plain"));
        return;
    }
    if method == Method::Get && url == "/debug/events" {
        let lines = recent.lock().map(|g| g.clone()).unwrap_or_default();
        let body = if lines.is_empty() {
            "No events received yet.\nHooks configured? Check ~/.claude/settings.json".to_string()
        } else {
            lines.join("\n")
        };
        let _ = request.respond(text(200, &body, "text/plain"));
        return;
    }
    if method == Method::Get && (url == "/agents" || url == "/hooks/sessions" || url == "/sessions")
    {
        let body = serde_json::to_string(&sessions.get_sessions()).unwrap_or_else(|_| "[]".into());
        let _ = request.respond(text(200, &body, "application/json"));
        return;
    }
    if method == Method::Post && (url == "/hooks/event" || url == "/hooks/permission") {
        let mut raw = String::new();
        let _ = request
            .as_reader()
            .take(8 * 1024 * 1024)
            .read_to_string(&mut raw);
        let payload = if raw.trim().is_empty() {
            json!({})
        } else {
            match serde_json::from_str::<Value>(&raw) {
                Ok(v) => v,
                Err(_) => {
                    let _ = request.respond(text(200, "{}", "application/json"));
                    return;
                }
            }
        };
        let normalized = crate::agent::normalize_hook_payload(&payload);
        let event_name = first_str(
            &[&normalized, &payload],
            &["hook_event_name", "hookEventName"],
        )
        .unwrap_or_else(|| "?".into());
        let ntype = first_str(
            &[&normalized, &payload],
            &["notification_type", "notificationType"],
        )
        .unwrap_or_default();
        let tool =
            first_str(&[&normalized, &payload], &["tool_name", "toolName"]).unwrap_or_default();
        let sid = first_str(&[&normalized, &payload], &["session_id", "sessionId"])
            .unwrap_or_else(|| "?".into());
        let stamp = chrono::Local::now().format("%H:%M:%S").to_string();
        let line = format!("{stamp} | event={event_name} ntype={ntype} tool={tool} sid={sid}");
        if let Ok(mut log) = recent.lock() {
            log.push(line.clone());
            if log.len() > 50 {
                log.remove(0);
            }
        }
        eprintln!("[HOOK] {line}");

        let handled = if url == "/hooks/permission" {
            let mut cloned = payload.clone();
            if let Some(obj) = cloned.as_object_mut() {
                obj.insert("hook_event_name".into(), json!("PermissionRequest"));
            }
            cloned
        } else {
            payload.clone()
        };
        let session = sessions.handle_event(&handled);
        if let Some(session) = &session {
            on_update(serde_json::to_value(session).unwrap_or(json!({})));
            let is_permission = event_name == "PermissionRequest"
                || (event_name == "Notification" && ntype == "permission_prompt")
                || url == "/hooks/permission";
            if is_permission {
                on_notify(
                    "permission",
                    &session.name,
                    if tool.is_empty() {
                        "needs permission"
                    } else {
                        tool.as_str()
                    },
                );
            }
            if event_name == "Stop" || event_name == "StopFailure" {
                on_notify("done", &session.name, "Agent finished");
            }
            if session.pending_question.is_some() && session.status == "waiting" {
                let q = session.pending_question.clone().unwrap_or_default();
                on_notify("question", &session.name, &q);
            }
        }
        if url == "/hooks/permission" {
            let session_id = session
                .as_ref()
                .map(|s| s.id.clone())
                .or_else(|| {
                    payload
                        .get("session_id")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                })
                .unwrap_or_default();
            let decision = sessions.wait_permission(&session_id, Duration::from_millis(300_000));
            let allow = decision == "allow";
            let body = json!({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": if allow { "allow" } else { "deny" },
                    "permissionDecisionReason": if allow { "Allowed in Winsur" } else { "Denied in Winsur" }
                }
            });
            let _ = request.respond(text(200, &body.to_string(), "application/json"));
            return;
        }
        let _ = request.respond(text(200, "{}", "application/json"));
        return;
    }
    let _ = request.respond(text(404, "Not found", "text/plain"));
}

fn first_str(values: &[&Value], keys: &[&str]) -> Option<String> {
    for value in values {
        for key in keys {
            if let Some(s) = value.get(*key).and_then(|v| v.as_str()) {
                if !s.is_empty() {
                    return Some(s.to_string());
                }
            }
        }
    }
    None
}
