//! Tauri commands. Argument names are snake_case here and camelCase in the UI.

use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;
use winsur_core::agent::Session;
use winsur_core::hooks::{self, resolve_hook_script};
use winsur_core::settings;
use winsur_core::ssh::SshManager;
use winsur_core::usage;

use crate::win32;
use crate::AppState;

fn window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window("main")
}

pub(crate) fn broadcast(app: &AppHandle, state: &AppState) {
    let Some(window) = window(app) else {
        return;
    };
    let _ = window.emit("agents-sync", state.sessions.get_sessions());
}

fn emit_session(app: &AppHandle, state: &AppState, session: &Session) {
    let Some(window) = window(app) else {
        return;
    };
    let _ = window.emit("agent-update", session);
    let _ = window.emit("agents-sync", state.sessions.get_sessions());
}

pub(crate) fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

async fn sleep_ms(ms: u64) {
    let _ =
        tauri::async_runtime::spawn_blocking(move || std::thread::sleep(Duration::from_millis(ms)))
            .await;
}

async fn release_island(app: &AppHandle, state: &AppState) {
    if let Some(window) = window(app) {
        let _ = window.set_always_on_top(false);
        state.overlay.force_ignore(&window, true);
        let _ = window.hide();
    }
    sleep_ms(220).await;
}

async fn restore_island(app: &AppHandle, state: &AppState, focus: bool) {
    if let Some(window) = window(app) {
        let _ = window.set_always_on_top(true);
        if focus {
            let _ = window.show();
            let _ = window.set_focus();
        } else {
            win32::show_inactive(&window);
        }
        state.overlay.sync_pointer(&window, true);
    }
}

fn session_fields(state: &AppState, session_id: &str) -> Option<(String, String, String, String)> {
    state
        .sessions
        .get_sessions()
        .into_iter()
        .find(|session| session.id == session_id)
        .map(|session| (session.id, session.cwd, session.name, session.agent_type))
}

fn jump_message(detail: &str) -> String {
    if detail.contains("AGENT_EXITED") {
        "Agent process already exited — the terminal tab often closes with it. Start the agent again, then jump.".into()
    } else if detail.contains("NO_WINDOW") {
        "Agent may still be running, but no matching window was found.".into()
    } else if detail.contains("NO_FOCUS") {
        "Found the terminal but could not bring it to the front.".into()
    } else {
        "Could not find agent terminal window".into()
    }
}

fn hook_script(app: &AppHandle) -> Option<PathBuf> {
    let resource = app.path().resource_dir().ok();
    resolve_hook_script(resource.as_deref())
}

#[tauri::command]
pub fn get_agents(state: State<AppState>) -> Vec<Session> {
    state.sessions.get_sessions()
}

#[tauri::command]
pub fn clear_agents(app: AppHandle, state: State<AppState>) -> Vec<Session> {
    state.sessions.dismiss_all();
    if let Some(window) = window(&app) {
        let _ = window.emit("agents-cleared", Vec::<Session>::new());
        let _ = window.emit("agents-sync", Vec::<Session>::new());
    }
    Vec::new()
}

#[tauri::command]
pub fn respond_permission(
    app: AppHandle,
    state: State<AppState>,
    session_id: String,
    decision: String,
) -> bool {
    let ok = state
        .sessions
        .respond_permission_arc(&session_id, &decision);
    if let Some(session) = state
        .sessions
        .get_sessions()
        .into_iter()
        .find(|session| session.id == session_id)
    {
        emit_session(&app, &state, &session);
    }
    ok
}

#[tauri::command]
pub async fn focus_terminal(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Value, String> {
    let Some((_, cwd, name, agent_type)) = session_fields(&state, &session_id) else {
        return Ok(json!({ "ok": false, "detail": "session not found" }));
    };
    release_island(&app, &state).await;
    let result = tauri::async_runtime::spawn_blocking(move || {
        win32::focus_terminal(&cwd, &name, &agent_type)
    })
    .await
    .map_err(|err| err.to_string())?;
    restore_island(&app, &state, !result.ok).await;
    if !result.ok {
        notify(&app, "Jump failed", &jump_message(&result.detail));
    }
    Ok(json!({ "ok": result.ok, "detail": result.detail }))
}

#[tauri::command]
pub fn get_settings() -> Value {
    settings::get_settings()
}

#[tauri::command]
pub fn save_settings(
    http_port: Option<u64>,
    sound_enabled: Option<bool>,
    sound_volume: Option<u64>,
    auto_start: Option<bool>,
    theme: Option<String>,
) -> Result<Value, String> {
    let mut patch = serde_json::Map::new();
    if let Some(value) = http_port {
        patch.insert("httpPort".into(), json!(value));
    }
    if let Some(value) = sound_enabled {
        patch.insert("soundEnabled".into(), json!(value));
    }
    if let Some(value) = sound_volume {
        patch.insert("soundVolume".into(), json!(value));
    }
    if let Some(value) = auto_start {
        patch.insert("autoStart".into(), json!(value));
    }
    if let Some(value) = theme {
        patch.insert("theme".into(), json!(value));
    }
    settings::save_settings(&Value::Object(patch)).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn get_usage() -> Vec<usage::UsageRow> {
    usage::collect_usage()
}

#[tauri::command]
pub fn ssh_list(state: State<AppState>) -> Vec<Value> {
    state.ssh.list_remotes()
}

#[tauri::command]
pub fn ssh_connect(state: State<AppState>, id: String) -> Result<Value, String> {
    state.ssh.connect_remote(&id)
}

#[tauri::command]
pub fn ssh_disconnect(state: State<AppState>, id: String) -> Value {
    state.ssh.disconnect_remote(&id)
}

#[tauri::command]
pub fn ssh_add(
    state: State<AppState>,
    id: Option<String>,
    name: Option<String>,
    host: String,
    remote_port: Option<u64>,
    enabled: Option<bool>,
) -> Vec<Value> {
    let remote = json!({
        "id": id.unwrap_or_default(),
        "name": name.unwrap_or_default(),
        "host": host,
        "remotePort": remote_port.unwrap_or(18900),
        "enabled": enabled.unwrap_or(false)
    });
    state.ssh.add_remote(&remote)
}

#[tauri::command]
pub fn ssh_remove(state: State<AppState>, id: String) -> Vec<Value> {
    state.ssh.remove_remote(&id)
}

#[tauri::command]
pub fn ssh_deploy_script() -> String {
    SshManager::deploy_script().to_string()
}

#[tauri::command]
pub async fn respond_plan(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    decision: String,
    message: Option<String>,
) -> Result<Value, String> {
    let Some((id, cwd, name, agent_type)) = session_fields(&state, &session_id) else {
        return Ok(json!({ "ok": false, "detail": "session not found" }));
    };
    let text = match decision.as_str() {
        "approve" => {
            let message = message.unwrap_or_default();
            if message.is_empty() {
                "Plan approved. Proceed.".to_string()
            } else {
                message
            }
        }
        "feedback" => {
            let message = message.unwrap_or_default();
            if message.is_empty() {
                "Please revise the plan.".to_string()
            } else {
                message
            }
        }
        _ => message.unwrap_or_default(),
    };
    release_island(&app, &state).await;
    let result = tauri::async_runtime::spawn_blocking(move || {
        win32::send_text(&cwd, &name, &agent_type, &text)
    })
    .await
    .map_err(|err| err.to_string())?;
    sleep_ms(120).await;
    restore_island(&app, &state, true).await;
    if result.ok {
        state.sessions.clear_plan(&id);
    }
    if let Some(updated) = state
        .sessions
        .get_sessions()
        .into_iter()
        .find(|session| session.id == id)
    {
        emit_session(&app, &state, &updated);
    } else {
        broadcast(&app, &state);
    }
    if !result.ok {
        notify(
            &app,
            "Plan reply failed",
            if result.detail.is_empty() {
                "Could not paste into terminal"
            } else {
                &result.detail
            },
        );
    }
    Ok(json!({ "ok": result.ok, "detail": result.detail }))
}

#[tauri::command]
pub fn dismiss_plan(app: AppHandle, state: State<AppState>, session_id: String) -> bool {
    state.sessions.clear_plan(&session_id);
    if let Some(updated) = state
        .sessions
        .get_sessions()
        .into_iter()
        .find(|session| session.id == session_id)
    {
        emit_session(&app, &state, &updated);
    } else {
        broadcast(&app, &state);
    }
    true
}

#[tauri::command]
pub fn dismiss_agent(app: AppHandle, state: State<AppState>, session_id: String) {
    state.sessions.dismiss(&session_id);
    broadcast(&app, &state);
}

#[tauri::command]
pub async fn reply_question(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    message: String,
) -> Result<Value, String> {
    let Some((id, cwd, name, agent_type)) = session_fields(&state, &session_id) else {
        return Ok(
            json!({ "ok": false, "detail": "no active agent session", "background": false }),
        );
    };
    let message = message.trim().to_string();
    if message.is_empty() {
        return Ok(json!({ "ok": false, "detail": "empty message", "background": false }));
    }
    release_island(&app, &state).await;
    let result = tauri::async_runtime::spawn_blocking(move || {
        win32::send_text(&cwd, &name, &agent_type, &message)
    })
    .await
    .map_err(|err| err.to_string())?;
    sleep_ms(200).await;
    restore_island(&app, &state, true).await;
    if result.ok {
        state.sessions.mark_reply_sent(&id);
        notify(&app, "Reply sent", "Message pasted into agent terminal");
    } else {
        let detail = if result.detail.chars().count() > 180 {
            let end = result
                .detail
                .char_indices()
                .nth(180)
                .map(|(idx, _)| idx)
                .unwrap_or(result.detail.len());
            result.detail[..end].to_string()
        } else if result.detail.is_empty() {
            "Could not paste".to_string()
        } else {
            result.detail.clone()
        };
        eprintln!("[reply_question] {}", result.detail);
        notify(&app, "Reply failed", &detail);
    }
    broadcast(&app, &state);
    Ok(json!({ "ok": result.ok, "detail": result.detail, "background": false }))
}

#[tauri::command]
pub fn install_hooks(app: AppHandle) -> Result<String, String> {
    let Some(script) = hook_script(&app) else {
        return Err("winsur-hook.ps1 was not found".into());
    };
    hooks::install_all_hooks(&script)
}

#[tauri::command]
pub fn uninstall_hooks() -> String {
    hooks::uninstall_all_hooks()
}

#[tauri::command]
pub fn check_hooks(app: AppHandle) -> Value {
    let script = hook_script(&app);
    hooks::check_hooks_status(script.as_deref())
}

#[tauri::command]
pub fn start_dragging(app: AppHandle, state: State<AppState>) {
    if let Some(window) = window(&app) {
        state.overlay.begin_drag(window);
    }
}

#[tauri::command]
pub fn stop_dragging(app: AppHandle, state: State<AppState>) {
    if let Some(window) = window(&app) {
        state.overlay.end_drag(&window);
    }
}

#[tauri::command]
pub fn report_island_metrics(
    app: AppHandle,
    state: State<AppState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    radius: f64,
) {
    if let Some(window) = window(&app) {
        state
            .overlay
            .note_metrics(&window, x, y, width, height, radius);
    }
}

/// Accepted so older UI builds do not throw. The cursor poll owns hit testing.
#[tauri::command]
pub fn set_ignore_mouse_events(ignore: bool) {
    let _ = ignore;
}
