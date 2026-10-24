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
mod logfile;
mod overlay;
mod win32;

pub use logfile::init as init_logging;

pub struct AppState {
    pub sessions: Arc<SessionManager>,
    pub ssh: Arc<SshManager>,
    pub overlay: Arc<overlay::Overlay>,
    pub hook: Mutex<Option<HookServer>>,
    pub discovery_stop: Arc<AtomicBool>,
}

static QUITTING: AtomicBool = AtomicBool::new(false);

fn request_quit(app: &AppHandle) {
    request_exit(app, 0);
}

fn request_exit(app: &AppHandle, code: i32) {
    QUITTING.store(true, Ordering::SeqCst);
    app.exit(code);
}

/// Show the island on the work area. `focus` is for the tray and a second launch.
/// Startup passes false so the notch does not take the foreground from the terminal.
pub(crate) fn reveal_island(app: &AppHandle, focus: bool) {
    let Some(window) = app.get_webview_window("main") else {
        logfile::write("reveal: main window missing");
        return;
    };
    if let Some(state) = app.try_state::<AppState>() {
        state.overlay.place(&window);
    }
    let prev = win32::foreground_raw();
    let ours = win32::hwnd_raw(&window);
    let _ = window.unminimize();
    let _ = window.set_always_on_top(true);
    if focus {
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        win32::show_inactive(&window);
    }
    // The WebView2 controller does not composite if it was created while the
    // parent HWND was hidden. Toggling it after the parent is shown paints the island.
    if let Some(webview) = app.get_webview("main") {
        let _ = webview.hide();
        let _ = webview.show();
    } else {
        logfile::write("reveal: webview missing");
    }
    if let Some(state) = app.try_state::<AppState>() {
        state.overlay.sync_pointer(&window, true);
    }
    log_window_state(&window, if focus { "reveal-focus" } else { "reveal" });
    if !focus {
        if let Some(ours) = ours {
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(500));
                win32::restore_foreground_if_ours(prev, ours);
            });
        }
    }
}

/// The window is taller than the pill. `smoke=ok` requires the pill itself,
/// not the transparent gutter, to intersect the virtual screen.
fn island_on_screen(app: &AppHandle) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    let Some(state) = app.try_state::<AppState>() else {
        return false;
    };
    let Some((x, y, w, h)) = state.overlay.measured_box() else {
        return false;
    };
    let Ok(inner) = window.inner_position() else {
        return false;
    };
    let scale = window.scale_factor().unwrap_or(1.0).max(0.01);
    let left = inner.x as f64 + x * scale;
    let top = inner.y as f64 + y * scale;
    let width = w * scale;
    let height = h * scale;
    let (vis_w, vis_h) = win32::visible_span(left, top, left + width, top + height);
    logfile::write(&format!(
        "island screen x={left:.1} y={top:.1} w={width:.1} h={height:.1} visible={vis_w:.0}x{vis_h:.0}"
    ));
    vis_w >= 40.0 && vis_h >= 16.0
}

fn probe_webview(window: &tauri::WebviewWindow) {
    // withGlobalTauri is on, so this runs even if the bundle threw before
    // main.tsx installed its own logger.
    let js = r#"
        (() => {
          const send = (message) => {
            try {
              const invoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
              if (invoke) invoke('frontend_log', { message: String(message).slice(0, 400) });
            } catch (_) {}
          };
          try {
            const root = document.getElementById('root');
            const pill = root && root.firstElementChild;
            const box = pill && pill.getBoundingClientRect();
            const text = (document.body && document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 80);
            send('probe href=' + location.href
              + ' state=' + document.readyState
              + ' html=' + document.documentElement.clientWidth + 'x' + document.documentElement.clientHeight
              + ' body=' + document.body.clientWidth + 'x' + document.body.clientHeight
              + ' root=' + (root ? root.clientWidth + 'x' + root.clientHeight : 'missing')
              + ' pill=' + (box ? box.x.toFixed(1) + ',' + box.y.toFixed(1) + ' ' + box.width.toFixed(1) + 'x' + box.height.toFixed(1) : 'missing')
              + ' text=' + text);
          } catch (err) {
            send('probe failed ' + err);
          }
        })()
    "#;
    match window.eval(js) {
        Ok(()) => logfile::write("webview eval queued"),
        Err(err) => logfile::write(&format!("webview eval failed: {err}")),
    }
}

fn log_window_state(window: &tauri::WebviewWindow, reason: &str) {
    logfile::write(&format!(
        "{reason} visible={:?} scale={:?} outer_pos={:?} outer_size={:?} on_screen={}",
        window.is_visible(),
        window.scale_factor(),
        window.outer_position(),
        window.outer_size(),
        win32::center_on_virtual_screen(window)
    ));
}

fn toggle_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        logfile::write("tray toggle: main window missing");
        return;
    };
    if win32::is_shown_on_screen(&window) {
        logfile::write("tray toggle -> hide");
        let _ = window.hide();
    } else {
        logfile::write("tray toggle -> show");
        reveal_island(app, true);
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
        logfile::write("agent discovery failed: process list unreadable");
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
            logfile::write("another launch was redirected to the running instance");
            reveal_island(app, true);
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
            commands::frontend_log,
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
                        logfile::write(&format!(
                            "hook server failed to start (port 18900 busy?): {err}"
                        ));
                        None
                    }
                }
            };

            sessions.clear_all();
            app.manage(AppState {
                sessions: sessions.clone(),
                ssh,
                overlay: overlay.clone(),
                hook: Mutex::new(server),
                discovery_stop: discovery_stop.clone(),
            });

            // Show before hook install. A hidden parent leaves the WebView2
            // controller invisible, which is a taskbar button and no notch.
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(Some(monitor)) = window.primary_monitor() {
                    let area = monitor.work_area();
                    logfile::write(&format!(
                        "primary scale={} work={},{} {}x{}",
                        monitor.scale_factor(),
                        area.position.x,
                        area.position.y,
                        area.size.width,
                        area.size.height
                    ));
                } else {
                    logfile::write("primary monitor unavailable");
                }
                reveal_island(app.handle(), false);
                overlay.arm(&window);
                let probe_app = handle.clone();
                thread::spawn(move || {
                    // The release subsystem has no console. Ask the page where
                    // the pill actually is, and record eval failures when the
                    // document never becomes scriptable.
                    for delay in [Duration::from_secs(1), Duration::from_secs(2)] {
                        thread::sleep(delay);
                        if let Some(window) = probe_app.get_webview_window("main") {
                            probe_webview(&window);
                        } else {
                            logfile::write("webview probe: main window missing");
                        }
                    }
                });
                let fallback_app = handle.clone();
                let fallback_overlay = overlay.clone();
                thread::spawn(move || {
                    thread::sleep(Duration::from_secs(3));
                    if fallback_overlay.has_painted() {
                        return;
                    }
                    logfile::write("island not painted after 3s; showing the webview again");
                    reveal_island(&fallback_app, false);
                });
            } else {
                logfile::write("main window missing at startup");
            }

            if logfile::smoke_requested() {
                let smoke_app = handle.clone();
                thread::spawn(move || {
                    // Stay running so the CI script can screenshot the live window.
                    // It kills the process after reading this line.
                    for _ in 0..20 {
                        thread::sleep(Duration::from_secs(1));
                        let shown = smoke_app
                            .get_webview_window("main")
                            .map(|window| win32::is_shown_on_screen(&window))
                            .unwrap_or(false);
                        let painted = smoke_app
                            .try_state::<AppState>()
                            .map(|state| state.overlay.has_painted())
                            .unwrap_or(false);
                        let island = island_on_screen(&smoke_app);
                        if shown && painted && island {
                            if let Some(window) = smoke_app.get_webview_window("main") {
                                log_window_state(&window, "smoke");
                            }
                            logfile::write("smoke=ok");
                            return;
                        }
                    }
                    if let Some(window) = smoke_app.get_webview_window("main") {
                        log_window_state(&window, "smoke");
                    }
                    logfile::write("smoke=fail");
                });
            }

            if let Err(err) = create_tray(app.handle()) {
                logfile::write(&format!("tray creation failed: {err}"));
            } else {
                logfile::write("tray ready");
            }

            match resolve_hook_script(app.path().resource_dir().ok().as_deref()) {
                Some(script) => {
                    let message = auto_install_on_launch(&script);
                    logfile::write(&message);
                }
                None => logfile::write("winsur-hook.ps1 was not found; hook install skipped"),
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
