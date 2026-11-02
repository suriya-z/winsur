//! Score top-level windows the same way the Electron jump script did.

use crate::discover::ProcessInfo;
use crate::registry::registry;
use std::collections::HashSet;

#[derive(Clone, Debug)]
pub struct TopWindow {
    pub hwnd: i64,
    pub pid: u32,
    pub title: String,
    pub class_name: String,
    pub proc_name: String,
}

#[derive(Clone, Debug)]
pub struct ScoredWindow {
    pub score: i32,
    pub window: TopWindow,
}

/// What the shell may do to its own window while focusing an agent.
/// Jump keeps the notch on screen. Paste flows hide it so keystrokes land
/// in the terminal, then show it again.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct JumpChrome {
    pub hide_window: bool,
    pub keep_taskbar: bool,
    pub always_on_top: bool,
    pub steal_focus: bool,
}

pub fn jump_chrome() -> JumpChrome {
    JumpChrome {
        hide_window: false,
        keep_taskbar: true,
        always_on_top: true,
        steal_focus: false,
    }
}

/// Taskbar activation must not leave the island minimized. A transparent
/// WebView2 window that minimizes on a taskbar click stays blank: the parent
/// HWND comes back, the controller does not. Refuse minimize, and if Windows
/// minimizes anyway, restore on the next poll.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TaskbarChrome {
    pub allow_minimize: bool,
    pub restore_if_minimized: bool,
}

pub fn taskbar_chrome() -> TaskbarChrome {
    TaskbarChrome {
        allow_minimize: false,
        restore_if_minimized: true,
    }
}

pub fn prefer_name(agent_type: &str) -> &'static str {
    match agent_type {
        "grok-build" => "grok",
        "claude-code" | "claude-desktop" => "claude",
        "codex" => "codex",
        "cursor" => "cursor",
        "hermes" => "hermes",
        "windsurf" => "windsurf",
        "gemini" => "gemini",
        "qwen-code" => "qwen",
        "opencode" => "opencode",
        "kiro" => "kiro",
        "trae" => "trae",
        "code-buddy" => "codebuddy",
        "antigravity" => "antigravity",
        "droid" => "droid",
        "kimi" => "kimi",
        "deepseek" => "deepseek",
        "amp" => "amp",
        "mistral" => "mistral",
        "zcode" => "zcode",
        "qoder" => "qoder",
        "mimocode" => "mimo",
        "workbuddy" => "workbuddy",
        "gajae" => "gajae",
        "copilot" => "copilot",
        _ => "",
    }
}

/// Words that identify a different product in a window title.
/// "code" is intentionally absent: it matches folder names and "VS Code".
const AGENT_WORDS: &[&str] = &[
    "grok",
    "claude",
    "codex",
    "cursor",
    "hermes",
    "windsurf",
    "gemini",
    "opencode",
    "antigravity",
    "qwen",
    "kiro",
    "trae",
    "deepseek",
    "kimi",
    "mistral",
    "copilot",
    "zcode",
    "qoder",
    "gajae",
    "droid",
];

pub fn agent_keywords(agent_type: &str) -> Vec<String> {
    // Host names (Terminal, Cursor, VS Code, Code) used to be needles for every
    // agent. A Cursor or VS Code title then outscored the terminal that was
    // actually running the session. Host bonuses live in the process-name
    // score; title needles are this product's own window hints.
    if let Some(reg) = registry().into_iter().find(|a| a.type_id == agent_type) {
        let hints: Vec<String> = reg.window_hints.iter().map(|s| (*s).to_string()).collect();
        if !hints.is_empty() {
            return hints;
        }
    }
    let prefer = prefer_name(agent_type);
    if prefer.is_empty() {
        Vec::new()
    } else {
        vec![prefer.to_string()]
    }
}

pub fn build_needles(cwd: &str, name: &str, agent_type: &str) -> Vec<String> {
    let last = cwd
        .split(['/', '\\'])
        .rfind(|p| !p.is_empty())
        .unwrap_or("");
    let blocked = |s: &str| {
        matches!(
            s.to_lowercase().as_str(),
            "users"
                | "documents"
                | "desktop"
                | "downloads"
                | "acer"
                | "admin"
                | "user"
                | "onedrive"
        )
    };
    let safe = |s: &str| {
        if s.len() >= 4 && !blocked(s) {
            Some(s.to_string())
        } else {
            None
        }
    };
    let mut out = Vec::new();
    for n in agent_keywords(agent_type) {
        if !out.contains(&n) {
            out.push(n);
        }
    }
    if let Some(n) = safe(name) {
        if !out.contains(&n) {
            out.push(n);
        }
    }
    if let Some(n) = safe(last) {
        if !out.contains(&n) {
            out.push(n);
        }
    }
    out
}

pub fn ancestor_pids(processes: &[ProcessInfo], pid: u32) -> HashSet<u32> {
    let mut set = HashSet::new();
    let mut cur = pid;
    for _ in 0..16 {
        if cur == 0 || !set.insert(cur) {
            break;
        }
        cur = processes
            .iter()
            .find(|p| p.pid == cur)
            .map(|p| p.parent_pid)
            .unwrap_or(0);
    }
    set
}

pub fn find_agent_pid(
    processes: &[ProcessInfo],
    agent_type: &str,
    prefer: &str,
    cwd: &str,
    live_pid: Option<u32>,
) -> u32 {
    if let Some(pid) = live_pid {
        if pid != 0 && processes.iter().any(|proc| proc.pid == pid) {
            return pid;
        }
    }
    let pool: Vec<&ProcessInfo> = processes
        .iter()
        .filter(|proc| match crate::discover::classify_process(proc) {
            Some(kind) => kind == agent_type,
            None => name_matches(&proc.name, prefer),
        })
        .collect();
    let cwd_key = norm_path_key(cwd);
    if !cwd_key.is_empty() {
        if let Some(hit) = pool.iter().find(|proc| {
            norm_path_key(&proc.command_line).contains(&cwd_key)
                || norm_path_key(&proc.executable_path).contains(&cwd_key)
        }) {
            return hit.pid;
        }
    }
    // One live process of this product is unambiguous. Two or more, with no
    // cwd in the command line, must not donate +400 to whichever happened to
    // be enumerated first — that is what focused the wrong app.
    if pool.len() == 1 {
        return pool[0].pid;
    }
    0
}

fn name_matches(name: &str, prefer: &str) -> bool {
    if prefer.is_empty() {
        return false;
    }
    let n = name.to_lowercase();
    let n = n.strip_suffix(".exe").unwrap_or(&n);
    n == prefer || n.contains(prefer)
}

fn norm_path_key(value: &str) -> String {
    value.replace('/', "\\").trim_matches('\\').to_lowercase()
}

fn is_host(proc_name: &str, class_name: &str) -> bool {
    let pn = proc_name.to_lowercase();
    let cls = class_name.to_lowercase();
    pn.contains("windowsterminal")
        || pn == "cmd"
        || pn == "powershell"
        || pn == "pwsh"
        || pn.contains("wezterm")
        || pn.contains("alacritty")
        || cls.contains("cascadia")
        || cls.contains("consolewindowclass")
        || cls.contains("mintty")
}

fn title_agent(title: &str) -> bool {
    let tl = title.to_lowercase();
    [
        "grok",
        "claude",
        "codex",
        "cursor",
        "terminal",
        "powershell",
        "cmd.exe",
        "pwsh",
    ]
    .iter()
    .any(|n| tl.contains(n))
}

fn has_word(hay: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    let hay = hay.to_lowercase();
    let needle = needle.to_lowercase();
    hay.match_indices(&needle).any(|(index, _)| {
        let before_ok = index == 0 || !hay.as_bytes()[index - 1].is_ascii_alphanumeric();
        let after = index + needle.len();
        let after_ok = after >= hay.len() || !hay.as_bytes()[after].is_ascii_alphanumeric();
        before_ok && after_ok
    })
}

fn foreign_title(title: &str, prefer: &str, folder: &str, session_name: &str) -> bool {
    let folder = folder.to_lowercase();
    let session_name = session_name.to_lowercase();
    AGENT_WORDS.iter().any(|token| {
        if *token == prefer {
            return false;
        }
        // A project literally named "claude-utils" is not the Claude app.
        if folder.contains(token) || session_name.contains(token) {
            return false;
        }
        has_word(title, token)
    })
}

fn unrelated_editor(proc_name: &str, prefer: &str) -> bool {
    let pn = proc_name.to_lowercase();
    let pn = pn.strip_suffix(".exe").unwrap_or(&pn);
    let editor = matches!(
        pn,
        "code" | "cursor" | "windsurf" | "devenv" | "antigravity" | "trae"
    ) || pn.contains("windsurf");
    if !editor {
        return false;
    }
    prefer.is_empty() || !pn.contains(prefer)
}

fn score_one(
    win: &TopWindow,
    needles: &[String],
    prefer: &str,
    agent_tree: &HashSet<u32>,
    folder: &str,
    session_name: &str,
    base: i32,
) -> i32 {
    let tl = win.title.to_lowercase();
    let pn = win.proc_name.to_lowercase();
    let cls = win.class_name.to_lowercase();
    let owned = agent_tree.contains(&win.pid);
    let mut score = base;
    for n in needles {
        if n.is_empty() {
            continue;
        }
        if tl.contains(&n.to_lowercase()) {
            score += 10 + (n.len() as i32).min(20);
        }
    }
    if folder.len() >= 4 && tl.contains(&folder.to_lowercase()) {
        score += 260;
    }
    if pn.contains("windowsterminal") {
        score += 30;
    }
    if cls.contains("cascadia") {
        score += 20;
    }
    if matches!(pn.as_str(), "cmd" | "powershell" | "pwsh") {
        score += 12;
    }
    if tl.contains("rainmeter") || tl.contains("player.ini") {
        score -= 250;
    }
    if !prefer.is_empty() && has_word(&win.title, prefer) {
        score += 180;
    }
    if !prefer.is_empty() && pn.contains(prefer) {
        score += 80;
    }
    if foreign_title(&win.title, prefer, folder, session_name) && !owned {
        score -= 320;
    }
    if unrelated_editor(&win.proc_name, prefer) && !owned {
        score -= 200;
    }
    if owned {
        score += 400;
    }
    score
}

pub fn pick_window(
    windows: &[TopWindow],
    needles: &[String],
    prefer: &str,
    agent_tree: &HashSet<u32>,
    folder: &str,
    session_name: &str,
) -> Option<ScoredWindow> {
    let mut scored = Vec::new();
    for w in windows {
        let pn = w.proc_name.to_lowercase();
        let host = is_host(&w.proc_name, &w.class_name);
        let titled = title_agent(&w.title);
        if !host
            && !titled
            && !(pn.contains("code") || pn.contains("cursor") || pn.contains("devenv"))
        {
            continue;
        }
        let score = score_one(w, needles, prefer, agent_tree, folder, session_name, 0);
        if score > 0 {
            scored.push(ScoredWindow {
                score,
                window: w.clone(),
            });
        }
    }
    if scored.is_empty() {
        for w in windows {
            if !is_host(&w.proc_name, &w.class_name) {
                continue;
            }
            if foreign_title(&w.title, prefer, folder, session_name) && !agent_tree.contains(&w.pid)
            {
                continue;
            }
            let score = score_one(w, needles, prefer, agent_tree, folder, session_name, 5);
            if score > 0 {
                scored.push(ScoredWindow {
                    score,
                    window: w.clone(),
                });
            }
        }
    }
    scored.into_iter().max_by_key(|s| s.score)
}

pub fn folder_label(cwd: &str) -> String {
    cwd.split(['/', '\\'])
        .rfind(|part| !part.is_empty())
        .unwrap_or("")
        .to_string()
}

pub fn agent_process_alive(processes: &[ProcessInfo]) -> bool {
    processes.iter().any(|p| {
        let n = p.name.to_lowercase();
        let n = n.strip_suffix(".exe").unwrap_or(&n);
        matches!(n, "grok" | "claude" | "codex")
    })
}

#[cfg(test)]
mod jump_chrome_tests {
    use super::*;

    #[test]
    fn jump_leaves_the_island_on_screen_and_on_the_taskbar() {
        let chrome = jump_chrome();
        assert!(!chrome.hide_window);
        assert!(chrome.keep_taskbar);
        assert!(chrome.always_on_top);
        assert!(!chrome.steal_focus);
    }

    #[test]
    fn taskbar_click_must_not_leave_the_notch_minimized() {
        let chrome = taskbar_chrome();
        assert!(!chrome.allow_minimize);
        assert!(chrome.restore_if_minimized);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn win(title: &str, proc_name: &str, class_name: &str, pid: u32) -> TopWindow {
        TopWindow {
            hwnd: pid as i64,
            pid,
            title: title.into(),
            class_name: class_name.into(),
            proc_name: proc_name.into(),
        }
    }

    #[test]
    fn prefers_the_agent_terminal_over_an_unrelated_hermes_title_when_jumping_to_grok() {
        let windows = vec![
            win(
                "Hermes — notes",
                "WindowsTerminal",
                "CASCADIA_HOSTING_WINDOW_CLASS",
                4,
            ),
            win(
                "grok — app",
                "WindowsTerminal",
                "CASCADIA_HOSTING_WINDOW_CLASS",
                5,
            ),
        ];
        let picked = pick_window(
            &windows,
            &build_needles(r"C:\work\app", "app", "grok-build"),
            "grok",
            &HashSet::new(),
            "app",
            "app",
        )
        .unwrap();
        assert!(picked.window.title.contains("grok"));
        assert!(picked.score > 200);
    }

    #[test]
    fn parent_tree_outranks_a_title_match() {
        let windows = vec![
            win(
                "grok somewhere",
                "WindowsTerminal",
                "CASCADIA_HOSTING_WINDOW_CLASS",
                9,
            ),
            win(
                "Windows Terminal",
                "WindowsTerminal",
                "CASCADIA_HOSTING_WINDOW_CLASS",
                3,
            ),
        ];
        let mut tree = HashSet::new();
        tree.insert(3);
        let picked = pick_window(&windows, &["grok".into()], "grok", &tree, "", "").unwrap();
        assert_eq!(picked.window.pid, 3);
    }

    #[test]
    fn unknown_agents_do_not_prefer_grok() {
        assert_eq!(prefer_name("windsurf"), "windsurf");
        assert_eq!(prefer_name("gemini"), "gemini");
        assert_eq!(prefer_name("unknown"), "");
    }

    #[test]
    fn claude_needles_do_not_include_every_editor() {
        let needles = build_needles(r"C:\work\payments", "payments", "claude-code");
        assert!(needles.iter().any(|n| n.eq_ignore_ascii_case("claude")));
        assert!(needles.iter().any(|n| n == "payments"));
        assert!(!needles.iter().any(|n| n.eq_ignore_ascii_case("cursor")));
        assert!(!needles.iter().any(|n| n.eq_ignore_ascii_case("code")));
        assert!(!needles.iter().any(|n| n.eq_ignore_ascii_case("vs code")));
    }

    #[test]
    fn jumping_to_claude_does_not_open_grok_or_cursor() {
        let windows = vec![
            win(
                "grok — other",
                "WindowsTerminal",
                "CASCADIA_HOSTING_WINDOW_CLASS",
                4,
            ),
            win("payments - Cursor", "Cursor", "Chrome_WidgetWin_1", 8),
            win(
                "payments",
                "WindowsTerminal",
                "CASCADIA_HOSTING_WINDOW_CLASS",
                5,
            ),
        ];
        let picked = pick_window(
            &windows,
            &build_needles(r"C:\work\payments", "payments", "claude-code"),
            "claude",
            &HashSet::new(),
            "payments",
            "payments",
        )
        .unwrap();
        assert_eq!(picked.window.pid, 5, "score {}", picked.score);
    }

    #[test]
    fn the_editor_that_owns_the_agent_still_wins() {
        let windows = vec![
            win("payments - Cursor", "Cursor", "Chrome_WidgetWin_1", 8),
            win(
                "other",
                "WindowsTerminal",
                "CASCADIA_HOSTING_WINDOW_CLASS",
                3,
            ),
        ];
        let mut tree = HashSet::new();
        tree.insert(8);
        let picked = pick_window(
            &windows,
            &build_needles(r"C:\work\payments", "payments", "claude-code"),
            "claude",
            &tree,
            "payments",
            "payments",
        )
        .unwrap();
        assert_eq!(picked.window.pid, 8);
    }

    fn proc(pid: u32, name: &str, command_line: &str) -> ProcessInfo {
        ProcessInfo {
            pid,
            parent_pid: 0,
            name: name.into(),
            command_line: command_line.into(),
            executable_path: String::new(),
        }
    }

    #[test]
    fn cwd_picks_the_session_process_and_two_unnamed_processes_do_not() {
        let processes = vec![
            proc(1, "claude.exe", ""),
            proc(2, "claude.exe", r"C:\work\payments"),
        ];
        assert_eq!(
            find_agent_pid(
                &processes,
                "claude-code",
                "claude",
                r"C:\work\payments",
                None
            ),
            2
        );
        let ambiguous = vec![proc(1, "claude.exe", ""), proc(2, "claude.exe", "")];
        assert_eq!(
            find_agent_pid(
                &ambiguous,
                "claude-code",
                "claude",
                r"C:\work\payments",
                None
            ),
            0
        );
        assert_eq!(
            find_agent_pid(
                &ambiguous,
                "claude-code",
                "claude",
                r"C:\work\payments",
                Some(2)
            ),
            2
        );
        assert_eq!(
            find_agent_pid(
                &[proc(7, "claude.exe", "")],
                "claude-code",
                "claude",
                r"C:\work\payments",
                None
            ),
            7
        );
    }
}
