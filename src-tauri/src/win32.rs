//! Win32 process discovery, click-through window flags, and terminal focus.
//! Replaces the Electron PowerShell scripts.

use std::collections::HashMap;
use std::ffi::c_void;
use std::mem::{size_of, zeroed};
use std::thread;
use std::time::Duration;

use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::WebviewWindow;
use windows::core::BOOL;
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, LPARAM, TRUE};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
};
use windows::Win32::System::Diagnostics::Debug::ReadProcessMemory;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::System::Threading::{
    AttachThreadInput, GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW,
    PROCESS_NAME_WIN32, PROCESS_QUERY_INFORMATION, PROCESS_QUERY_LIMITED_INFORMATION,
    PROCESS_VM_READ,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
    VK_CONTROL, VK_MENU, VK_RETURN, VK_V,
};
use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
use windows::Win32::UI::WindowsAndMessaging::{
    AllowSetForegroundWindow, BringWindowToTop, EnumWindows, GetClassNameW, GetForegroundWindow,
    GetSystemMetrics, GetWindowLongPtrW, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, PostMessageW,
    SetForegroundWindow, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_STYLE, HWND_TOPMOST,
    SC_RESTORE, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
    SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_RESTORE, SW_SHOW,
    SW_SHOWNOACTIVATE, WM_SYSCOMMAND, WNDENUMPROC, WS_THICKFRAME,
};
use winsur_core::discover::ProcessInfo;
use winsur_core::focus::{
    agent_process_alive, ancestor_pids, build_needles, find_agent_pid, pick_window, prefer_name,
    TopWindow,
};

const ASFW_ANY: u32 = u32::MAX;

#[link(name = "ntdll")]
extern "system" {
    fn NtQueryInformationProcess(
        process: HANDLE,
        class: u32,
        info: *mut c_void,
        len: u32,
        ret_len: *mut u32,
    ) -> i32;
}

#[repr(C)]
struct ProcessBasicInformation {
    _exit_status: isize,
    peb_base_address: *mut u8,
    _affinity: usize,
    _priority: i32,
    _pid: usize,
    _parent: usize,
}

#[repr(C)]
struct UnicodeString {
    length: u16,
    _max: u16,
    buffer: *mut u16,
}

pub fn set_app_user_model_id() {
    let wide: Vec<u16> = "com.winsur.app"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        let _ = SetCurrentProcessExplicitAppUserModelID(windows::core::PCWSTR(wide.as_ptr()));
    }
}

pub fn hwnd_of(window: &WebviewWindow) -> Option<HWND> {
    let handle = window.window_handle().ok()?;
    match handle.as_raw() {
        RawWindowHandle::Win32(win) => Some(HWND(win.hwnd.get() as *mut c_void)),
        _ => None,
    }
}

/// Drop the thick frame so its invisible resize border is not a dead click zone,
/// matching Electron `thickFrame: false`.
pub fn strip_thick_frame(window: &WebviewWindow) {
    let Some(hwnd) = hwnd_of(window) else {
        return;
    };
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        SetWindowLongPtrW(hwnd, GWL_STYLE, style & !(WS_THICKFRAME.0 as isize));
    }
}

pub fn show_inactive(window: &WebviewWindow) {
    let Some(hwnd) = hwnd_of(window) else {
        let _ = window.show();
        return;
    };
    // SW_SHOW would activate the island and steal the terminal. The WebView2
    // controller still has to be flipped visible by the caller after this,
    // because a controller created while the parent was hidden does not paint
    // when only the parent HWND is shown.
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED,
        );
    }
}

pub fn foreground_hwnd() -> HWND {
    unsafe { GetForegroundWindow() }
}

/// If WebView2's show activated us, give the foreground back to whoever had it.
pub fn restore_foreground_if_ours(prev: HWND, ours: HWND) {
    unsafe {
        if prev.0.is_null() || ours.0.is_null() || !IsWindow(Some(prev)).as_bool() {
            return;
        }
        let fg = GetForegroundWindow();
        if fg.0.is_null() {
            return;
        }
        let mut fg_pid = 0u32;
        let mut our_pid = 0u32;
        GetWindowThreadProcessId(fg, Some(&mut fg_pid));
        GetWindowThreadProcessId(ours, Some(&mut our_pid));
        if fg_pid != 0 && fg_pid == our_pid {
            let _ = SetForegroundWindow(prev);
        }
    }
}

pub fn center_on_virtual_screen(window: &WebviewWindow) -> bool {
    let Ok(pos) = window.outer_position() else {
        return false;
    };
    let Ok(size) = window.outer_size() else {
        return false;
    };
    if size.width < 32 || size.height < 32 {
        return false;
    }
    let (vx, vy, vw, vh) = virtual_screen();
    if vw <= 0 || vh <= 0 {
        return true;
    }
    let cx = pos.x + (size.width as i32) / 2;
    let cy = pos.y + (size.height as i32) / 2;
    cx >= vx && cx < vx + vw && cy >= vy && cy < vy + vh
}

pub fn is_shown_on_screen(window: &WebviewWindow) -> bool {
    window.is_visible().unwrap_or(false) && center_on_virtual_screen(window)
}

fn virtual_screen() -> (i32, i32, i32, i32) {
    unsafe {
        (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
            GetSystemMetrics(SM_CXVIRTUALSCREEN),
            GetSystemMetrics(SM_CYVIRTUALSCREEN),
        )
    }
}

fn interesting_name(name: &str) -> bool {
    let n = name.to_lowercase();
    [
        "claude",
        "codex",
        "cursor",
        "grok",
        "windsurf",
        "node",
        "gemini",
        "qwen",
        "kiro",
        "hermes",
        "opencode",
        "trae",
        "codebuddy",
        "antigravity",
        "droid",
        "kimi",
        "deepseek",
        "mistral",
        "vibe",
        "zcode",
        "qoder",
        "mimo",
        "workbuddy",
        "gajae",
        "amp",
    ]
    .iter()
    .any(|k| n.contains(k))
}

fn wide_to_string(buf: &[u16]) -> String {
    let end = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

fn read_remote(process: HANDLE, addr: *const c_void, out: &mut [u8]) -> bool {
    if addr.is_null() {
        return false;
    }
    let mut read = 0usize;
    unsafe {
        ReadProcessMemory(
            process,
            addr,
            out.as_mut_ptr() as *mut c_void,
            out.len(),
            Some(&mut read),
        )
        .is_ok()
            && read == out.len()
    }
}

fn command_line_of(process: HANDLE) -> String {
    unsafe {
        let mut pbi: ProcessBasicInformation = zeroed();
        let status = NtQueryInformationProcess(
            process,
            0,
            &mut pbi as *mut _ as *mut c_void,
            size_of::<ProcessBasicInformation>() as u32,
            std::ptr::null_mut(),
        );
        if status < 0 || pbi.peb_base_address.is_null() {
            return String::new();
        }
        let mut params_ptr = 0usize;
        if !read_remote(
            process,
            pbi.peb_base_address.add(0x20) as *const c_void,
            std::slice::from_raw_parts_mut(
                &mut params_ptr as *mut usize as *mut u8,
                size_of::<usize>(),
            ),
        ) {
            return String::new();
        }
        if params_ptr == 0 {
            return String::new();
        }
        let mut us: UnicodeString = zeroed();
        if !read_remote(
            process,
            (params_ptr + 0x70) as *const c_void,
            std::slice::from_raw_parts_mut(
                &mut us as *mut UnicodeString as *mut u8,
                size_of::<UnicodeString>(),
            ),
        ) {
            return String::new();
        }
        let chars = (us.length as usize) / 2;
        if chars == 0 || chars > 32_768 || us.buffer.is_null() {
            return String::new();
        }
        let mut buf = vec![0u16; chars];
        if !read_remote(
            process,
            us.buffer as *const c_void,
            std::slice::from_raw_parts_mut(buf.as_mut_ptr() as *mut u8, chars * 2),
        ) {
            return String::new();
        }
        String::from_utf16_lossy(&buf)
    }
}

fn image_path_of(process: HANDLE) -> String {
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    unsafe {
        if QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buf.as_mut_ptr()),
            &mut len,
        )
        .is_ok()
        {
            return wide_to_string(&buf[..len as usize]);
        }
    }
    String::new()
}

/// `None` means the snapshot failed. Callers must not reap sessions on `None`.
pub fn list_processes() -> Option<Vec<ProcessInfo>> {
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        let mut entry: PROCESSENTRY32W = zeroed();
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        let mut out = Vec::new();
        if Process32FirstW(snap, &mut entry).is_ok() {
            loop {
                let name = wide_to_string(&entry.szExeFile);
                let pid = entry.th32ProcessID;
                let parent = entry.th32ParentProcessID;
                let mut command_line = String::new();
                let mut executable_path = String::new();
                if interesting_name(&name) {
                    if let Ok(handle) = OpenProcess(
                        PROCESS_QUERY_INFORMATION
                            | PROCESS_VM_READ
                            | PROCESS_QUERY_LIMITED_INFORMATION,
                        false,
                        pid,
                    ) {
                        executable_path = image_path_of(handle);
                        command_line = command_line_of(handle);
                        let _ = CloseHandle(handle);
                    } else if let Ok(handle) =
                        OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
                    {
                        executable_path = image_path_of(handle);
                        let _ = CloseHandle(handle);
                    }
                }
                out.push(ProcessInfo {
                    pid,
                    parent_pid: parent,
                    name,
                    command_line,
                    executable_path,
                });
                entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
                if Process32NextW(snap, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
        Some(out)
    }
}

fn title_of(hwnd: HWND) -> String {
    unsafe {
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return String::new();
        }
        let mut buf = vec![0u16; (len as usize) + 1];
        let n = GetWindowTextW(hwnd, &mut buf);
        if n <= 0 {
            return String::new();
        }
        wide_to_string(&buf[..n as usize])
    }
}

fn class_of(hwnd: HWND) -> String {
    let mut buf = [0u16; 256];
    unsafe {
        let n = GetClassNameW(hwnd, &mut buf);
        if n <= 0 {
            return String::new();
        }
        wide_to_string(&buf[..n as usize])
    }
}

fn is_terminal_host(proc_name: &str, class_name: &str) -> bool {
    let pl = proc_name.to_lowercase();
    let cls = class_name.to_lowercase();
    pl.contains("windowsterminal")
        || pl == "cmd"
        || pl == "powershell"
        || pl == "pwsh"
        || pl.contains("wezterm")
        || pl.contains("alacritty")
        || pl.contains("openconsole")
        || cls.contains("cascadia")
        || cls.contains("consolewindowclass")
}

fn skip_process(proc_name: &str) -> bool {
    let pl = proc_name.to_lowercase();
    [
        "rainmeter",
        "wallpaper",
        "chrome",
        "msedge",
        "firefox",
        "discord",
        "spotify",
        "slack",
        "telegram",
        "notepad",
        "applicationframehost",
        "systemsettings",
        "textinputhost",
        "searchhost",
        "shellexperiencehost",
        "startmenuexperiencehost",
    ]
    .iter()
    .any(|n| pl.contains(n))
        || pl == "explorer"
}

unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let list = &mut *(lparam.0 as *mut Vec<(HWND, String, String, u32)>);
    let title = title_of(hwnd);
    if title.trim().is_empty() {
        return TRUE;
    }
    if title == "Default IME" || title == "MSCTFIME UI" || title == "DDE Server Window" {
        return TRUE;
    }
    let lower = title.to_lowercase();
    if lower.contains("winsur") || lower.contains("vibe island") {
        return TRUE;
    }
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    let class_name = class_of(hwnd);
    list.push((hwnd, title, class_name, pid));
    TRUE
}

pub fn list_top_windows(processes: &[ProcessInfo]) -> Vec<TopWindow> {
    let mut raw: Vec<(HWND, String, String, u32)> = Vec::new();
    let names: HashMap<u32, String> = processes.iter().map(|p| (p.pid, p.name.clone())).collect();
    unsafe {
        let cb: WNDENUMPROC = Some(enum_proc);
        let _ = EnumWindows(cb, LPARAM(&mut raw as *mut _ as isize));
    }
    raw.into_iter()
        .filter_map(|(hwnd, title, class_name, pid)| {
            let proc_name = names.get(&pid).cloned().unwrap_or_default();
            let host = is_terminal_host(&proc_name, &class_name);
            let visible = unsafe { IsWindowVisible(hwnd).as_bool() };
            if !visible && !host {
                return None;
            }
            if skip_process(&proc_name) {
                return None;
            }
            Some(TopWindow {
                hwnd: hwnd.0 as isize as i64,
                pid,
                title,
                class_name,
                proc_name,
            })
        })
        .collect()
}

fn key_input(vk: VIRTUAL_KEY, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: if up {
                    KEYEVENTF_KEYUP
                } else {
                    Default::default()
                },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn tap_alt() {
    let inputs = [key_input(VK_MENU, false), key_input(VK_MENU, true)];
    unsafe {
        SendInput(&inputs, size_of::<INPUT>() as i32);
    }
}

fn force_foreground(hwnd: HWND) -> bool {
    unsafe {
        if hwnd.0.is_null() || !IsWindow(Some(hwnd)).as_bool() {
            return false;
        }
        let _ = AllowSetForegroundWindow(ASFW_ANY);
        if IsIconic(hwnd).as_bool() {
            let _ = PostMessageW(
                Some(hwnd),
                WM_SYSCOMMAND,
                windows::Win32::Foundation::WPARAM(SC_RESTORE as usize),
                LPARAM(0),
            );
            let _ = ShowWindow(hwnd, SW_RESTORE);
            thread::sleep(Duration::from_millis(100));
        } else {
            let _ = ShowWindow(hwnd, SW_SHOW);
        }
        tap_alt();
        let mut dummy = 0u32;
        let fg = GetForegroundWindow();
        let fg_tid = GetWindowThreadProcessId(fg, Some(&mut dummy));
        let cur = GetCurrentThreadId();
        let tgt = GetWindowThreadProcessId(hwnd, Some(&mut dummy));
        let mut a1 = false;
        let mut a2 = false;
        if fg_tid != 0 && fg_tid != cur {
            a1 = AttachThreadInput(cur, fg_tid, true).as_bool();
        }
        if tgt != 0 && tgt != cur && tgt != fg_tid {
            a2 = AttachThreadInput(cur, tgt, true).as_bool();
        }
        let _ = BringWindowToTop(hwnd);
        let ok = SetForegroundWindow(hwnd).as_bool();
        if a2 {
            let _ = AttachThreadInput(cur, tgt, false);
        }
        if a1 {
            let _ = AttachThreadInput(cur, fg_tid, false);
        }
        thread::sleep(Duration::from_millis(70));
        if GetForegroundWindow() != hwnd {
            tap_alt();
            let _ = SetForegroundWindow(hwnd);
            thread::sleep(Duration::from_millis(90));
        }
        GetForegroundWindow() == hwnd || ok
    }
}

fn is_foreground(hwnd: HWND) -> bool {
    unsafe { !hwnd.0.is_null() && GetForegroundWindow() == hwnd }
}

fn set_clipboard(text: &str) -> Result<(), String> {
    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let bytes = wide.len() * 2;
    unsafe {
        OpenClipboard(None).map_err(|e| e.to_string())?;
        if EmptyClipboard().is_err() {
            let _ = CloseClipboard();
            return Err("clipboard".into());
        }
        let h = GlobalAlloc(GMEM_MOVEABLE, bytes).map_err(|e| e.to_string())?;
        let ptr = GlobalLock(h);
        if ptr.is_null() {
            let _ = CloseClipboard();
            return Err("clipboard lock".into());
        }
        std::ptr::copy_nonoverlapping(wide.as_ptr(), ptr as *mut u16, wide.len());
        let _ = GlobalUnlock(h);
        if SetClipboardData(13, Some(HANDLE(h.0))).is_err() {
            let _ = CloseClipboard();
            return Err("clipboard set".into());
        }
        let _ = CloseClipboard();
    }
    Ok(())
}

fn paste_and_enter() {
    let paste = [
        key_input(VK_CONTROL, false),
        key_input(VK_V, false),
        key_input(VK_V, true),
        key_input(VK_CONTROL, true),
    ];
    unsafe {
        SendInput(&paste, size_of::<INPUT>() as i32);
    }
    thread::sleep(Duration::from_millis(180));
    let enter = [key_input(VK_RETURN, false), key_input(VK_RETURN, true)];
    unsafe {
        SendInput(&enter, size_of::<INPUT>() as i32);
    }
}

#[derive(Clone, Debug)]
pub struct SendOutcome {
    pub ok: bool,
    pub detail: String,
}

fn locate(
    cwd: &str,
    name: &str,
    agent_type: &str,
    processes: &[ProcessInfo],
) -> Result<TopWindow, String> {
    let needles = build_needles(cwd, name, agent_type);
    let prefer = prefer_name(agent_type);
    let agent_pid = find_agent_pid(processes, prefer);
    let tree = ancestor_pids(processes, agent_pid);
    let windows = list_top_windows(processes);
    if let Some(best) = pick_window(&windows, &needles, prefer, &tree) {
        return Ok(best.window);
    }
    if !agent_process_alive(processes) {
        Err("FAIL|AGENT_EXITED".into())
    } else {
        Err(format!("FAIL|NO_WINDOW|wins={}", windows.len()))
    }
}

pub fn focus_terminal(cwd: &str, name: &str, agent_type: &str) -> SendOutcome {
    let Some(processes) = list_processes() else {
        return SendOutcome {
            ok: false,
            detail: "FAIL|NO_WINDOW|process list unreadable".into(),
        };
    };
    let window = match locate(cwd, name, agent_type, &processes) {
        Ok(w) => w,
        Err(detail) => return SendOutcome { ok: false, detail },
    };
    let hwnd = HWND(window.hwnd as *mut c_void);
    let forced = force_foreground(hwnd);
    thread::sleep(Duration::from_millis(140));
    let fg = is_foreground(hwnd);
    let ok = forced || fg;
    let detail = if ok {
        format!("OK|{forced}|{fg}|{}|{}", window.proc_name, window.title)
    } else {
        format!("FAIL|NO_FOCUS|{}|{}", window.proc_name, window.title)
    };
    SendOutcome { ok, detail }
}

pub fn send_text(cwd: &str, name: &str, agent_type: &str, message: &str) -> SendOutcome {
    let text = message.trim();
    if text.is_empty() {
        return SendOutcome {
            ok: false,
            detail: "empty message".into(),
        };
    }
    let Some(processes) = list_processes() else {
        return SendOutcome {
            ok: false,
            detail: "FAIL|NO_WINDOW|process list unreadable".into(),
        };
    };
    let window = match locate(cwd, name, agent_type, &processes) {
        Ok(w) => w,
        Err(detail) => return SendOutcome { ok: false, detail },
    };
    let hwnd = HWND(window.hwnd as *mut c_void);
    let mut fg = false;
    for _ in 0..2 {
        let _ = force_foreground(hwnd);
        thread::sleep(Duration::from_millis(220));
        fg = is_foreground(hwnd);
        if fg {
            break;
        }
    }
    if !fg {
        return SendOutcome {
            ok: false,
            detail: format!("FAIL|NO_FOCUS|title={}", window.title),
        };
    }
    if let Err(err) = set_clipboard(text) {
        return SendOutcome {
            ok: false,
            detail: format!("FAIL|CLIPBOARD|{err}"),
        };
    }
    if !is_foreground(hwnd) {
        let _ = force_foreground(hwnd);
        thread::sleep(Duration::from_millis(160));
        if !is_foreground(hwnd) {
            return SendOutcome {
                ok: false,
                detail: format!("FAIL|LOST_FOCUS_BEFORE_PASTE|title={}", window.title),
            };
        }
    }
    thread::sleep(Duration::from_millis(60));
    paste_and_enter();
    thread::sleep(Duration::from_millis(400));
    SendOutcome {
        ok: true,
        detail: format!(
            "OK|fg=True|proc={}|title={}",
            window.proc_name, window.title
        ),
    }
}

pub fn cursor_physical() -> Option<(f64, f64)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut pt = POINT::default();
    unsafe { GetCursorPos(&mut pt).ok()? };
    Some((pt.x as f64, pt.y as f64))
}
