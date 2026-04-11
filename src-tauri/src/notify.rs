// Windows Toast 通知模块
// Agent 需要关注时弹出系统通知

use winrt_toast::{Toast, Text, ToastManager};

const APP_ID: &str = "VibeIsland.Win";

fn show(title: &str, body: &str) {
    let title = title.to_string();
    let body = body.to_string();
    std::thread::spawn(move || {
        let manager = ToastManager::new(APP_ID);
        let mut toast = Toast::new();
        toast.text1(&title).text2(Text::new(&body));
        if let Err(e) = manager.show(&toast) {
            log::warn!("Toast 失败: {}", e);
        }
    });
}

/// Agent 完成任务
pub fn notify_agent_done(session_name: &str) {
    show(
        &format!("Vibe Island — {}", session_name),
        "Task done, awaiting your input",
    );
}

/// 权限审批
pub fn notify_permission_needed(session_name: &str, tool_name: &str) {
    show(
        &format!("Vibe Island — {}", session_name),
        &format!("Approve {} ?", tool_name),
    );
}

/// Agent 提问
pub fn notify_question(session_name: &str, question: &str) {
    let q = if question.len() > 80 { &question[..80] } else { question };
    show(
        &format!("Vibe Island — {}", session_name),
        q,
    );
}
