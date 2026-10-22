//! Score top-level windows the same way the Electron jump script did.

use crate::discover::ProcessInfo;
use crate::registry::{registry, terminal_hints};
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

pub fn prefer_name(agent_type: &str) -> &'static str {
    match agent_type {
        "grok-build" => "grok",
        "claude-code" | "claude-desktop" => "claude",
        "codex" => "codex",
        "cursor" => "cursor",
        "hermes" => "hermes",
        _ => "grok",
    }
}

pub fn agent_keywords(agent_type: &str) -> Vec<String> {
    if let Some(reg) = registry().into_iter().find(|a| a.type_id == agent_type) {
        let mut hints: Vec<String> = reg.window_hints.iter().map(|s| (*s).to_string()).collect();
        hints.extend(terminal_hints().iter().map(|s| (*s).to_string()));
        if !hints.is_empty() {
            return hints;
        }
    }
    [
        "Windows Terminal",
        "Terminal",
        "cmd",
        "powershell",
        "pwsh",
        "WezTerm",
        "VS Code",
        "Cursor",
        "grok",
        "claude",
        "codex",
    ]
    .into_iter()
    .map(|s| s.to_string())
    .collect()
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

pub fn find_agent_pid(processes: &[ProcessInfo], prefer: &str) -> u32 {
    if prefer.is_empty() {
        return 0;
    }
    let p = prefer.to_lowercase();
    if let Some(hit) = processes.iter().find(|x| {
        let n = x.name.to_lowercase();
        let n = n.strip_suffix(".exe").unwrap_or(&n);
        n == p
    }) {
        return hit.pid;
    }
    processes
        .iter()
        .find(|x| x.name.to_lowercase().contains(&p))
        .map(|x| x.pid)
        .unwrap_or(0)
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

fn score_one(
    win: &TopWindow,
    needles: &[String],
    prefer: &str,
    agent_tree: &HashSet<u32>,
    base: i32,
) -> i32 {
    let tl = win.title.to_lowercase();
    let pn = win.proc_name.to_lowercase();
    let cls = win.class_name.to_lowercase();
    let mut score = base;
    for n in needles {
        if n.is_empty() {
            continue;
        }
        if tl.contains(&n.to_lowercase()) {
            score += 10 + (n.len() as i32).min(20);
        }
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
    if matches!(pn.as_str(), "code" | "cursor") {
        score += 8;
    }
    if tl.contains("grok") {
        score += 130;
    }
    if tl.contains("claude") {
        score += 90;
    }
    if tl.contains("codex") {
        score += 90;
    }
    if tl.contains("hermes") && prefer == "grok" {
        score -= 150;
    }
    if tl.contains("rainmeter") || tl.contains("player.ini") {
        score -= 250;
    }
    if !prefer.is_empty() && tl.contains(prefer) {
        score += 200;
    }
    if !prefer.is_empty() && pn.contains(prefer) {
        score += 80;
    }
    if agent_tree.contains(&win.pid) {
        score += 400;
    }
    score
}

pub fn pick_window(
    windows: &[TopWindow],
    needles: &[String],
    prefer: &str,
    agent_tree: &HashSet<u32>,
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
        let score = score_one(w, needles, prefer, agent_tree, 0);
        if score > 0 {
            scored.push(ScoredWindow {
                score,
                window: w.clone(),
            });
        }
    }
    if scored.is_empty() {
        for w in windows {
            if is_host(&w.proc_name, &w.class_name) {
                let mut score = 5;
                if !prefer.is_empty() && w.title.to_lowercase().contains(prefer) {
                    score = 250;
                }
                if agent_tree.contains(&w.pid) {
                    score += 400;
                }
                scored.push(ScoredWindow {
                    score,
                    window: w.clone(),
                });
            }
        }
    }
    scored.into_iter().max_by_key(|s| s.score)
}

pub fn agent_process_alive(processes: &[ProcessInfo]) -> bool {
    processes.iter().any(|p| {
        let n = p.name.to_lowercase();
        let n = n.strip_suffix(".exe").unwrap_or(&n);
        matches!(n, "grok" | "claude" | "codex")
    })
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
        let picked = pick_window(&windows, &["grok".into()], "grok", &tree).unwrap();
        assert_eq!(picked.window.pid, 3);
    }
}
