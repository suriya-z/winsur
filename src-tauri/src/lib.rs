// Vibe Island Win - Rust 后端核心
// 功能：HTTP Server 接收 Agent Hook 事件 + 会话管理 + 窗口控制 + 系统托盘

mod server;
mod agent;
mod commands;
mod window;
mod notify;
pub mod hook_installer;

use std::sync::Arc;
use tauri::Manager;
use tokio::sync::RwLock;

/// 应用全局共享状态
pub struct AppState {
    /// Agent 会话管理器
    pub session_manager: agent::SessionManager,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            session_manager: agent::SessionManager::new(),
        }
    }
}

/// Tauri 应用入口配置
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Arc::new(RwLock::new(AppState::new())))
        .invoke_handler(tauri::generate_handler![
            commands::get_agents,
            commands::respond_permission,
            commands::focus_terminal,
            commands::get_settings,
            commands::dismiss_agent,
            commands::reply_question,
            commands::install_hooks,
            commands::uninstall_hooks,
            commands::check_hooks,
            commands::list_windows,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // 启动 HTTP 服务器，接收 Agent Hook 事件
            let server_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::start_hook_server(server_handle, 18900).await {
                    log::error!("Hook 服务器启动失败: {}", e);
                }
            });

            // 设置系统托盘
            setup_tray(app)?;

            log::info!("Vibe Island Win 已启动，Hook 服务器监听端口 18900");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用失败");
}

/// 配置系统托盘
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;
    let show = MenuItem::with_id(app, "show", "Show Panel", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide Panel", true, None::<&str>)?;
    let sep = tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Exit Vibe Island", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &sep, &quit])?;

    // 生成 32x32 RGBA 托盘图标
    // 设计：深蓝圆底 + 冰蓝波浪纹 = Vibe Island logo
    let size: u32 = 32;
    let center = (size as f32) / 2.0 - 0.5;
    let radius = 14.0_f32;
    let mut rgba = Vec::with_capacity((size * size * 4) as usize);
    for y in 0..size {
        for x in 0..size {
            let fx = x as f32 - center;
            let fy = y as f32 - center;
            let dist = (fx * fx + fy * fy).sqrt();

            if dist <= radius {
                // 圆内
                let norm_y = (y as f32) / (size as f32);
                // 波浪线位置（sin 曲线）
                let wave = 0.5 + 0.08 * (fx * 0.5).sin() + 0.05 * (fx * 0.8 + 1.0).sin();

                if norm_y < wave - 0.06 {
                    // 上半：Nord 深蓝 #3b4252
                    rgba.extend_from_slice(&[0x3B, 0x42, 0x52, 0xFF]);
                } else if norm_y < wave + 0.06 {
                    // 波浪：冰蓝 #88c0d0
                    rgba.extend_from_slice(&[0x88, 0xC0, 0xD0, 0xFF]);
                } else {
                    // 下半：极光青 #8fbcbb
                    rgba.extend_from_slice(&[0x8F, 0xBC, 0xBB, 0xFF]);
                }
            } else if dist <= radius + 1.0 {
                // 抗锯齿边缘
                let alpha = ((radius + 1.0 - dist) * 255.0) as u8;
                rgba.extend_from_slice(&[0x88, 0xC0, 0xD0, alpha]);
            } else {
                rgba.extend_from_slice(&[0, 0, 0, 0]);
            }
        }
    }
    let icon = tauri::image::Image::new_owned(rgba, size, size);

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Vibe Island - AI Agent Monitor")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("island") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "hide" => {
                if let Some(window) = app.get_webview_window("island") {
                    let _ = window.hide();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            use tauri::tray::TrayIconEvent;
            if let TrayIconEvent::Click { button, .. } = event {
                if button == tauri::tray::MouseButton::Left {
                    let app = tray.app_handle();
                    if let Some(window) = app.get_webview_window("island") {
                        if window.is_visible().unwrap_or(false) {
                            let _ = window.hide();
                        } else {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}
