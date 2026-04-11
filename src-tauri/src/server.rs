// HTTP Hook 服务器模块
// 功能：接收 Claude Code / Codex / Cursor / Antigravity 的 Hook 事件
// 权限请求采用阻塞模式：HTTP 响应会等待用户在面板上点击 Allow/Deny

use crate::AppState;
use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;

/// 最近收到的事件（调试用）
static RECENT_EVENTS: std::sync::LazyLock<std::sync::Mutex<Vec<String>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(Vec::new()));

/// 服务器共享状态
#[derive(Clone)]
struct ServerState {
    app_handle: AppHandle,
}

/// 启动 Hook HTTP 服务器
///
/// 监听 localhost:port，接收所有 Agent 的 Hook 事件
/// 事件通过 Tauri emit 转发到前端
/// 权限请求会阻塞 HTTP 响应，直到用户做出决定
pub async fn start_hook_server(app_handle: AppHandle, port: u16) -> Result<(), Box<dyn std::error::Error>> {
    let state = ServerState {
        app_handle,
    };

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/debug/events", get(debug_events))
        .route("/hooks/event", post(handle_hook_event))
        // 权限请求端点（阻塞模式）
        .route("/hooks/permission", post(handle_permission_request))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = format!("127.0.0.1:{}", port);
    log::info!("Hook 服务器启动: http://{}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

/// 健康检查
async fn health_check() -> &'static str {
    "Vibe Island Win Hook Server OK"
}

/// 调试：查看最近收到的事件
async fn debug_events() -> String {
    if let Ok(events) = RECENT_EVENTS.lock() {
        if events.is_empty() {
            "No events received yet.\nHooks configured? Check ~/.claude/settings.json".to_string()
        } else {
            events.join("\n")
        }
    } else {
        "Lock error".to_string()
    }
}

/// 处理普通 Hook 事件（非阻塞）
///
/// 用于 SessionStart, PreToolUse, PostToolUse, Stop, SessionEnd 等
async fn handle_hook_event(
    State(state): State<ServerState>,
    Json(payload): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // 详细日志：打印完整事件方便调试
    let event_name_val = payload.get("hook_event_name").and_then(|v| v.as_str()).unwrap_or("?");
    let ntype = payload.get("notification_type").and_then(|v| v.as_str()).unwrap_or("");
    let tool = payload.get("tool_name").and_then(|v| v.as_str()).unwrap_or("");
    let sid = payload.get("session_id").and_then(|v| v.as_str()).unwrap_or("?");
    let log_line = format!("{} | event={} ntype={} tool={} sid={}",
        chrono::Local::now().format("%H:%M:%S"), event_name_val, ntype, tool, sid);
    log::info!("[HOOK] {}", log_line);
    if let Ok(mut events) = RECENT_EVENTS.lock() {
        events.push(log_line);
        if events.len() > 50 { events.remove(0); }
    }

    // 解析事件 payload
    let event: crate::agent::HookEventPayload = match serde_json::from_value(payload.clone()) {
        Ok(e) => e,
        Err(err) => {
            log::warn!("解析 Hook 事件失败: {}", err);
            return Ok(Json(serde_json::json!({})));
        }
    };

    let event_name = event.hook_event_name.clone();

    // 获取 AppState 并更新会话
    let app_state = state.app_handle.state::<Arc<RwLock<AppState>>>();
    let updated_session = {
        let mut s = app_state.write().await;
        s.session_manager.handle_event(&event, &payload)
    };

    // 将事件 emit 到前端
    if let Some(session) = &updated_session {
        let _ = state.app_handle.emit("agent-update", session);

        // 权限请求 emit（兼容旧格式 PermissionRequest 和真实的 Notification/permission_prompt）
        let is_permission = event_name == "PermissionRequest"
            || (event_name == "Notification" && event.notification_type.as_deref() == Some("permission_prompt"));

        if is_permission {
            log::info!("发送权限请求事件到前端: session={}", session.id);
            let _ = state.app_handle.emit("permission-request", &serde_json::json!({
                "session_id": session.id,
                "tool_name": event.tool_name.as_deref().or(event.title.as_deref()).unwrap_or("Permission"),
                "tool_input": event.tool_input,
                "message": event.message,
            }));
            // Windows Toast 通知
            let tool = event.tool_name.as_deref().or(event.title.as_deref()).unwrap_or("tool");
            crate::notify::notify_permission_needed(&session.name, tool);
        }

        // Stop = Agent 完成一轮，发 Toast 通知
        if event_name == "Stop" {
            crate::notify::notify_agent_done(&session.name);
        }

        // 提问通知
        let is_question = event_name == "Notification"
            && matches!(event.notification_type.as_deref(), Some("elicitation_dialog") | Some("idle_prompt"));
        if is_question {
            let msg = event.message.as_deref().unwrap_or("Needs your input");
            crate::notify::notify_question(&session.name, msg);
        }
    }

    Ok(Json(serde_json::json!({})))
}

/// 处理权限请求（阻塞模式）
///
/// Agent 的 Hook 脚本调用此端点后会一直等待，直到用户在面板上点击 Allow/Deny
/// 返回 { "decision": "allow" } 或 { "decision": "deny" }
/// 超时 5 分钟自动返回 deny
async fn handle_permission_request(
    State(state): State<ServerState>,
    Json(payload): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    log::info!("收到阻塞权限请求: {:?}", payload.get("tool_name"));

    // 解析事件 payload
    let event: crate::agent::HookEventPayload = match serde_json::from_value(payload.clone()) {
        Ok(e) => e,
        Err(err) => {
            log::warn!("解析权限请求失败: {}", err);
            return Ok(Json(serde_json::json!({"decision": "deny"})));
        }
    };

    let session_id = event.session_id.clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    // 创建 oneshot 通道，等待用户决策
    let (tx, rx) = tokio::sync::oneshot::channel::<crate::agent::PermissionDecision>();

    // 更新会话状态并注册通道
    {
        let app_state = state.app_handle.state::<Arc<RwLock<AppState>>>();
        let mut s = app_state.write().await;
        let session = s.session_manager.handle_event(&event, &payload);

        // 注册权限响应通道
        s.session_manager.register_permission_channel(&session_id, tx);

        // emit 到前端
        if let Some(session) = &session {
            let _ = state.app_handle.emit("agent-update", session);
            let _ = state.app_handle.emit("permission-request", &serde_json::json!({
                "session_id": session.id,
                "tool_name": event.tool_name,
                "tool_input": event.tool_input,
                "message": event.message,
            }));
        }
    }

    // 阻塞等待用户决策，超时 5 分钟
    let decision = tokio::select! {
        result = rx => {
            match result {
                Ok(d) => d.decision,
                Err(_) => "deny".to_string(),
            }
        }
        _ = tokio::time::sleep(std::time::Duration::from_secs(300)) => {
            log::warn!("权限请求超时(5分钟)，自动 deny: session={}", session_id);
            // 清理超时的权限请求
            let app_state = state.app_handle.state::<Arc<RwLock<AppState>>>();
            let mut s = app_state.write().await;
            s.session_manager.respond_permission(&session_id, "deny");
            "deny".to_string()
        }
    };

    log::info!("权限请求响应: session={}, decision={}", session_id, decision);

    // 返回 Claude Code 标准格式的权限响应
    // 参考: https://docs.anthropic.com/en/docs/agents-tools/claude-code/hooks
    Ok(Json(serde_json::json!({
        "decision": decision.clone(),
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": if decision == "allow" { "allow" } else { "deny" },
        },
        "continue": true
    })))
}
