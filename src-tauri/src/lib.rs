//! Winsur Tauri shell. Win32 and the webview live here; session logic is in winsur-core.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use winsur_core::agent::{DiscoverInfo, SessionManager};
use winsur_core::discover::{collect_artifacts, plan_discoveries};
use winsur_core::hooks::{auto_install_on_launch, resolve_hook_script};
use winsur_core::server::HookServer;
use winsur_core::ssh::SshManager;

use crate::commands::notify;

mod commands;
mod overlay;
mod win32;

pub struct AppState {
    pub sessions: Arc<SessionManager>,
    pub ssh: Arc<SshManager>,
    pub overlay: Arc<overlay::Overlay>,
    pub hook: Mutex<Option<HookServer>>,
    pub discovery_stop: Arc<AtomicBool>,
}

static QUITTING: AtomicBool = AtomicBool::new(false);

fn request_quit(app: &AppHandle) {
    QUITTING.store(true, Ordering::SeqCst);
    app.exit(0);
}

fn toggle_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.set_always_on_top(true);
    }
}

fn create_tray(app: &AppHandle) -> Result<(), String> {
    let icon =
        Image::from_bytes(include_bytes!("../icons/32x32.png")).map_err(|err| err.to_string())?;
    let show = MenuItem::with_id(app, "show-hide", "Show / Hide", true, None::<&str>)
        .map_err(|err| err.to_string())?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)
        .map_err(|err| err.to_string())?;
    let separator = PredefinedMenuItem::separator(app).map_err(|err| err.to_string())?;
    let menu = Menu::with_items(app, &[&show, &separator, &quit]).map_err(|err| err.to_string())?;
    TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Winsur")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show-hide" => toggle_window(app),
            "quit" => request_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        })
        .build(app)
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn emit_update(app: &AppHandle, sessions: &SessionManager, session: &Value) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.emit("agent-update", session);
    let _ = window.emit("agents-sync", sessions.get_sessions());
}

fn sync_running(sessions: &SessionManager, app: &AppHandle) {
    let Some(processes) = win32::list_processes() else {
        eprintln!("[Winsur] Agent discovery failed: process list unreadable");
        return;
    };
    let home = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_default();
    let appdata = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_default();
    let artifacts = collect_artifacts(&home, &appdata);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let plan = plan_discoveries(&processes, &artifacts, now);
    let mut changed = false;
    for planned in &plan.sessions {
        let info = DiscoverInfo {
            id: planned.id.clone(),
            agent_type: planned.agent_type.clone(),
            cwd: planned.cwd.clone(),
            name: planned.name.clone(),
            pid: planned.pid,
            status: planned.status.clone(),
            last_event_at: planned.last_event_at.clone(),
        };
        if sessions.note_discovered(&info).created {
            changed = true;
        }
    }
    let pids: HashSet<u32> = plan.pids.into_iter().collect();
    let types: HashSet<String> = plan.types.into_iter().collect();
    let removed = sessions.reap(Some(&pids), Some(&types), now);
    if changed || !removed.is_empty() {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.emit("agents-sync", sessions.get_sessions());
        }
    }
}

fn cleanup(app: &AppHandle) {
    static DONE: AtomicBool = AtomicBool::new(false);
    if DONE.swap(true, Ordering::SeqCst) {
        return;
    }
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    state.discovery_stop.store(true, Ordering::SeqCst);
    state.overlay.stop();
    state.ssh.disconnect_all();
    if let Ok(mut hook) = state.hook.lock() {
        if let Some(server) = hook.as_mut() {
            server.stop();
        }
    };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            eprintln!("Another launch was redirected to the running Winsur instance.");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_always_on_top(true);
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_agents,
            commands::clear_agents,
            commands::respond_permission,
            commands::focus_terminal,
            commands::get_settings,
            commands::save_settings,
            commands::get_usage,
            commands::ssh_list,
            commands::ssh_connect,
            commands::ssh_disconnect,
            commands::ssh_add,
            commands::ssh_remove,
            commands::ssh_deploy_script,
            commands::respond_plan,
            commands::dismiss_plan,
            commands::dismiss_agent,
            commands::reply_question,
            commands::install_hooks,
            commands::uninstall_hooks,
            commands::check_hooks,
            commands::start_dragging,
            commands::stop_dragging,
            commands::report_island_metrics,
            commands::set_ignore_mouse_events,
        ])
        .setup(|app| {
            win32::set_app_user_model_id();
            let handle = app.handle().clone();
            let sessions = Arc::new(SessionManager::new());
            let ssh = Arc::new(SshManager::new());
            let overlay = Arc::new(overlay::Overlay::new());
            let discovery_stop = Arc::new(AtomicBool::new(false));

            sessions.set_idle_callback({
                let handle = handle.clone();
                let sessions = sessions.clone();
                move |session| {
                    if let Ok(value) = serde_json::to_value(&session) {
                        emit_update(&handle, &sessions, &value);
                    }
                }
            });

            let server = {
                let sessions = sessions.clone();
                let on_update = {
                    let handle = handle.clone();
                    let sessions = sessions.clone();
                    Arc::new(move |session: Value| emit_update(&handle, &sessions, &session))
                };
                let on_notify = {
                    let handle = handle.clone();
                    Arc::new(move |kind: &str, title: &str, body: &str| {
                        let heading = match kind {
                            "permission" => format!("Permission — {title}"),
                            "done" => format!("Done — {title}"),
                            "question" => format!("Question — {title}"),
                            _ => return,
                        };
                        let body = body.to_string();
                        let handle = handle.clone();
                        let _ = handle
                            .clone()
                            .run_on_main_thread(move || notify(&handle, &heading, &body));
                    })
                };
                match HookServer::start(sessions, on_update, on_notify) {
                    Ok(server) => Some(server),
                    Err(err) => {
                        eprintln!("Hook server failed to start (port 18900 busy?): {err}");
                        None
                    }
                }
            };

            sessions.clear_all();
            match resolve_hook_script(app.path().resource_dir().ok().as_deref()) {
                Some(script) => {
                    let message = auto_install_on_launch(&script);
                    eprintln!("[Winsur] {message}");
                }
                None => eprintln!("[Winsur] winsur-hook.ps1 was not found; hook install skipped"),
            }

            app.manage(AppState {
                sessions: sessions.clone(),
                ssh,
                overlay: overlay.clone(),
                hook: Mutex::new(server),
                discovery_stop: discovery_stop.clone(),
            });

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(true);
                overlay.attach(&window);
                win32::strip_thick_frame(&window);
                win32::show_inactive(&window);
                overlay.sync_pointer(&window, true);
                let fallback = window.clone();
                thread::spawn(move || {
                    thread::sleep(Duration::from_secs(2));
                    if fallback.is_visible().ok() == Some(false) {
                        eprintln!("[Winsur] Fallback timeout -> showing window");
                        win32::show_inactive(&fallback);
                    }
                });
            }

            if let Err(err) = create_tray(app.handle()) {
                eprintln!("[Winsur] Tray creation warning: {err}");
            }

            let sessions_d = sessions.clone();
            let handle_d = handle.clone();
            thread::spawn(move || loop {
                if discovery_stop.load(Ordering::SeqCst) {
                    break;
                }
                sync_running(&sessions_d, &handle_d);
                for _ in 0..40 {
                    if discovery_stop.load(Ordering::SeqCst) {
                        return;
                    }
                    thread::sleep(Duration::from_millis(500));
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if !QUITTING.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Winsur")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                cleanup(app);
            }
        });
}
