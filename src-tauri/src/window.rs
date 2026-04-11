// Windows 窗口管理模块
// 功能：根据 Agent 类型查找对应窗口并强制切换焦点
// 使用 AttachThreadInput 技巧绕过 Windows 的前台窗口限制

/// 根据 Agent 类型确定搜索关键字
/// 每组关键字按优先级排列：越前面的越精确
fn get_search_keywords(agent_type: &str) -> Vec<&'static str> {
    match agent_type {
        // Claude Code CLI 通常运行在终端窗口中，窗口标题含路径或 "claude"
        "claude-code" => vec!["claude code", "claude"],
        // Codex CLI 运行在终端
        "codex"       => vec!["codex", "openai codex"],
        // Cursor 编辑器
        "cursor"      => vec!["cursor"],
        // 反重力/Antigravity 桌面应用
        "antigravity" => vec!["antigravity", "反重力", "antigravity code"],
        // Claude Desktop 桌面应用
        "claude-desktop" => vec!["claude", "claude desktop"],
        // OpenCode CLI
        "opencode"    => vec!["opencode"],
        // Qwen Code CLI
        "qwen-code"   => vec!["qwen", "qwen code"],
        // CodeBuddy
        "codebuddy"   => vec!["codebuddy"],
        // Windsurf 编辑器
        "windsurf"    => vec!["windsurf"],
        _ => vec![],
    }
}

/// 强制将窗口切到前台（绕过 Windows 限制）
///
/// Windows 不允许后台进程调用 SetForegroundWindow。
/// 经典技巧：模拟一次 Alt 键按下/释放，Windows 会临时允许 SetForegroundWindow。
#[cfg(windows)]
unsafe fn force_foreground(hwnd: windows::Win32::Foundation::HWND) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::*;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
        KEYEVENTF_KEYUP, VK_MENU, KEYBD_EVENT_FLAGS,
    };

    // 1. 恢复窗口（如果最小化了）
    let _ = ShowWindow(hwnd, SW_RESTORE);

    // 2. 模拟按下并释放 Alt 键——这让 Windows 允许我们调用 SetForegroundWindow
    let alt_down = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VK_MENU,
                wScan: 0,
                dwFlags: KEYBD_EVENT_FLAGS(0),
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let alt_up = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VK_MENU,
                wScan: 0,
                dwFlags: KEYEVENTF_KEYUP,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let inputs = [alt_down, alt_up];
    SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);

    // 3. 现在可以 SetForegroundWindow 了
    let _ = BringWindowToTop(hwnd);
    let result = SetForegroundWindow(hwnd);

    // 4. 确保窗口可见
    let _ = ShowWindow(hwnd, SW_SHOW);

    result.as_bool()
}

/// 查找并聚焦匹配的应用窗口
pub fn focus_terminal_window(cwd: &str, _session_name: &str, agent_type: &str) -> Result<bool, String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{
            EnumWindows, GetWindowTextW, IsWindowVisible,
        };

        struct WinInfo {
            hwnd: HWND,
            title: String,
        }
        struct Collector {
            wins: Vec<WinInfo>,
        }

        let mut data = Collector { wins: Vec::new() };

        unsafe extern "system" fn enum_cb(hwnd: HWND, lp: LPARAM) -> BOOL {
            let d = &mut *(lp.0 as *mut Collector);
            if !IsWindowVisible(hwnd).as_bool() { return BOOL(1); }
            let mut buf = [0u16; 512];
            let len = GetWindowTextW(hwnd, &mut buf);
            if len == 0 { return BOOL(1); }
            let title = String::from_utf16_lossy(&buf[..len as usize]);
            if title.contains("Vibe Island") { return BOOL(1); }
            d.wins.push(WinInfo { hwnd, title });
            BOOL(1)
        }

        unsafe {
            let _ = EnumWindows(Some(enum_cb), LPARAM(&mut data as *mut Collector as isize));
        }

        let keywords = get_search_keywords(agent_type);
        let project = cwd.split(['/', '\\']).filter(|s| !s.is_empty()).last().unwrap_or("").to_lowercase();
        let cwd_lower = cwd.to_lowercase().replace('\\', "/");

        let mut best: Option<HWND> = None;
        let mut best_score: u32 = 0;

        // 判断是否是终端类 Agent（运行在 Terminal/PowerShell 中）
        let is_terminal_agent = matches!(agent_type, "claude-code" | "codex" | "opencode" | "qwen-code" | "codebuddy");

        for w in &data.wins {
            let tl = w.title.to_lowercase();
            let mut score: u32 = 0;

            // Agent 关键字匹配（越精确的关键字分值越高）
            for (i, kw) in keywords.iter().enumerate() {
                if tl.contains(kw) {
                    // 第一个关键字（最精确）得分最高
                    score += 50 - (i as u32) * 5;
                    break;
                }
            }

            // 项目名匹配
            if project.len() > 2 && tl.contains(&project) { score += 30; }

            // 完整路径匹配（最可靠的信号）
            let tl_slash = tl.replace('\\', "/");
            if cwd_lower.len() > 3 && tl_slash.contains(&cwd_lower) { score += 40; }

            // 终端类 Agent 偏好终端窗口
            if is_terminal_agent {
                if tl.contains("terminal") || tl.contains("powershell")
                    || tl.contains("cmd") || tl.contains("windows terminal") {
                    score += 10;
                }
            }

            // 非终端 Agent（IDE/桌面应用）降低终端窗口权重
            if !is_terminal_agent {
                if tl.contains("terminal") || tl.contains("powershell") || tl.contains("cmd") {
                    if score > 10 { score -= 10; }
                }
            }

            if score > 0 && score > best_score {
                best_score = score;
                best = Some(w.hwnd);
            }
        }

        // 回退：找任何终端
        if best.is_none() {
            for w in &data.wins {
                let tl = w.title.to_lowercase();
                if tl.contains("terminal") || tl.contains("powershell")
                    || tl.contains("cmd") || tl.contains("命令提示符") {
                    best = Some(w.hwnd);
                    break;
                }
            }
        }

        if let Some(hwnd) = best {
            let ok = unsafe { force_foreground(hwnd) };
            return Ok(ok);
        }

        let titles: Vec<String> = data.wins.iter().take(8).map(|w| w.title.clone()).collect();
        Err(format!("未找到 {} 窗口 (cwd={}, 关键字={:?}, 可见窗口={})", agent_type, cwd, keywords, titles.join(" | ")))
    }

    #[cfg(not(windows))]
    { Err("仅支持 Windows".to_string()) }
}

/// 列出所有可见窗口
pub fn list_visible_windows() -> Vec<(String, u32)> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
        use windows::Win32::UI::WindowsAndMessaging::*;

        struct D { wins: Vec<(String, u32)> }
        let mut data = D { wins: Vec::new() };

        unsafe extern "system" fn cb(hwnd: HWND, lp: LPARAM) -> BOOL {
            let d = &mut *(lp.0 as *mut D);
            if !IsWindowVisible(hwnd).as_bool() { return BOOL(1); }
            let mut buf = [0u16; 512];
            let len = GetWindowTextW(hwnd, &mut buf);
            if len == 0 { return BOOL(1); }
            let title = String::from_utf16_lossy(&buf[..len as usize]);
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            d.wins.push((title, pid));
            BOOL(1)
        }

        unsafe { let _ = EnumWindows(Some(cb), LPARAM(&mut data as *mut D as isize)); }
        data.wins
    }

    #[cfg(not(windows))]
    { Vec::new() }
}

/// 向窗口发送文本（回复 Agent 提问）
pub fn send_text_to_window(cwd: &str, session_name: &str, agent_type: &str, text: &str) -> Result<bool, String> {
    focus_terminal_window(cwd, session_name, agent_type)?;

    #[cfg(windows)]
    {
        use windows::Win32::UI::Input::KeyboardAndMouse::*;

        std::thread::sleep(std::time::Duration::from_millis(200));

        let mut inputs: Vec<INPUT> = Vec::new();
        for ch in text.encode_utf16() {
            inputs.push(INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 {
                ki: KEYBDINPUT { wVk: VIRTUAL_KEY(0), wScan: ch, dwFlags: KEYEVENTF_UNICODE, time: 0, dwExtraInfo: 0 }
            }});
            inputs.push(INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 {
                ki: KEYBDINPUT { wVk: VIRTUAL_KEY(0), wScan: ch, dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 }
            }});
        }
        // Enter
        inputs.push(INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 {
            ki: KEYBDINPUT { wVk: VK_RETURN, wScan: 0, dwFlags: KEYBD_EVENT_FLAGS(0), time: 0, dwExtraInfo: 0 }
        }});
        inputs.push(INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 {
            ki: KEYBDINPUT { wVk: VK_RETURN, wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 }
        }});

        let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
        Ok(sent == inputs.len() as u32)
    }

    #[cfg(not(windows))]
    { Err("仅支持 Windows".to_string()) }
}
