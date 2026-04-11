// Tauri IPC 命令模块
// 功能：处理前端通过 invoke 调用的命令

use crate::AppState;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::RwLock;

/// 获取所有 Agent 会话列表
///
/// 前端调用: invoke("get_agents")
/// 返回: AgentSession[]
#[tauri::command(rename_all = "camelCase")]
pub async fn get_agents(
    state: tauri::State<'_, Arc<RwLock<AppState>>>,
) -> Result<Vec<crate::agent::AgentSession>, String> {
    let state = state.read().await;
    Ok(state.session_manager.get_sessions())
}

/// 响应权限请求（用户在面板上点击 Allow/Deny）
///
/// 前端调用: invoke("respond_permission", { sessionId, decision })
/// 修复：无论是否有 oneshot channel，都更新状态并 emit 回前端
#[tauri::command(rename_all = "camelCase")]
pub async fn respond_permission(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<RwLock<AppState>>>,
    session_id: String,
    decision: String,
) -> Result<bool, String> {
    let mut s = state.write().await;
    let channel_ok = s.session_manager.respond_permission(&session_id, &decision);

    // 不管 channel 是否存在，都重新获取最新 session 并 emit 给前端
    if let Some(session) = s.session_manager.get_sessions().iter().find(|a| a.id == session_id) {
        let _ = app_handle.emit("agent-update", session);
    }

    Ok(channel_ok)
}

/// 聚焦到指定 Agent 对应的终端窗口
///
/// 前端调用: invoke("focus_terminal", { sessionId })
#[tauri::command(rename_all = "camelCase")]
pub async fn focus_terminal(
    state: tauri::State<'_, Arc<RwLock<AppState>>>,
    session_id: String,
) -> Result<bool, String> {
    let state = state.read().await;

    // 获取会话的工作目录，用于匹配终端窗口
    let sessions = state.session_manager.get_sessions();
    let session = sessions.iter().find(|s| s.id == session_id);

    if let Some(session) = session {
        // 根据 Agent 类型和会话信息查找并聚焦对应窗口
        let agent_type_str = session.agent_type.as_str();
        crate::window::focus_terminal_window(&session.cwd, &session.name, agent_type_str)
            .map_err(|e| e.to_string())
    } else {
        Err("会话不存在".to_string())
    }
}

/// 获取应用设置
///
/// 前端调用: invoke("get_settings")
#[tauri::command]
pub async fn get_settings() -> Result<serde_json::Value, String> {
    // 返回默认设置（后续可从配置文件读取）
    Ok(serde_json::json!({
        "httpPort": 18900,
        "soundEnabled": true,
        "soundVolume": 80,
        "autoStart": false,
        "theme": "dark",
    }))
}

/// 移除/关闭一个 Agent 会话（从面板中移除）
///
/// 前端调用: invoke("dismiss_agent", { sessionId })
#[tauri::command(rename_all = "camelCase")]
pub async fn dismiss_agent(
    state: tauri::State<'_, Arc<RwLock<AppState>>>,
    session_id: String,
) -> Result<(), String> {
    let mut state = state.write().await;
    state.session_manager.remove_session(&session_id);
    Ok(())
}

/// 安装所有检测到的 Agent hooks
///
/// 前端调用: invoke("install_hooks")
/// 自动扫描 Claude Code / Codex / Claude Desktop / Antigravity / OpenCode
#[tauri::command]
pub async fn install_hooks() -> Result<String, String> {
    crate::hook_installer::install_all_hooks()
}

/// 卸载所有 Agent hooks
///
/// 前端调用: invoke("uninstall_hooks")
#[tauri::command]
pub async fn uninstall_hooks() -> Result<String, String> {
    crate::hook_installer::uninstall_all_hooks()
}

/// 检查 hooks 安装状态
///
/// 前端调用: invoke("check_hooks")
#[tauri::command]
pub async fn check_hooks() -> Result<serde_json::Value, String> {
    Ok(crate::hook_installer::check_hooks_status())
}

/// 向 Agent 终端发送回复消息
///
/// 前端调用: invoke("reply_question", { sessionId, message })
/// 先聚焦到 Agent 终端窗口，然后通过 SendInput 输入文字并按 Enter
#[tauri::command(rename_all = "camelCase")]
pub async fn reply_question(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<RwLock<AppState>>>,
    session_id: String,
    message: String,
) -> Result<bool, String> {
    // 先获取会话信息用于跳转
    let (cwd, name, agent_type_str) = {
        let s = state.read().await;
        let sessions = s.session_manager.get_sessions();
        let session = sessions.iter().find(|s| s.id == session_id)
            .ok_or("会话不存在")?;
        let at = session.agent_type.as_str();
        (session.cwd.clone(), session.name.clone(), at.to_string())
    };

    // 尝试向终端窗口发送文字（即使失败也不阻塞）
    let send_result = crate::window::send_text_to_window(&cwd, &name, &agent_type_str, &message);
    if let Err(e) = &send_result {
        log::warn!("send_text_to_window 失败: {}", e);
    }

    // 无论发送是否成功，都清除提问状态并 emit 更新
    {
        let mut s = state.write().await;
        s.session_manager.clear_question(&session_id);
        if let Some(session) = s.session_manager.get_sessions().iter().find(|a| a.id == session_id) {
            let _ = app_handle.emit("agent-update", session);
        }
    }

    // 如果发送失败，返回 Ok(false) 而不是 Err，避免前端出错
    Ok(send_result.unwrap_or(false))
}

/// 列出所有可见窗口（调试用）
///
/// 前端调用: invoke("list_windows")
#[tauri::command]
pub async fn list_windows() -> Result<Vec<(String, u32)>, String> {
    Ok(crate::window::list_visible_windows())
}
