//! Agent matrix — detect + install hooks. Paths are Windows locations.

use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct AgentHost {
    pub name: &'static str,
    pub key: &'static str,
    pub type_id: &'static str,
    pub kind: &'static str,
    pub config_path: Option<PathBuf>,
    pub hooks_key: &'static str,
    pub detect_dirs: Vec<PathBuf>,
    pub bin_names: &'static [&'static str],
    pub window_hints: &'static [&'static str],
}

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

fn appdata() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_default()
}

fn localappdata() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_default()
}

fn under(base: &Path, parts: &[&str]) -> Option<PathBuf> {
    if base.as_os_str().is_empty() {
        return None;
    }
    let mut p = base.to_path_buf();
    for part in parts {
        p.push(part);
    }
    Some(p)
}

pub fn registry() -> Vec<AgentHost> {
    let h = home();
    let a = appdata();
    let l = localappdata();
    let host = |name,
                key,
                type_id,
                kind,
                config: Option<PathBuf>,
                hooks_key,
                detect: Vec<Option<PathBuf>>,
                bins,
                hints| AgentHost {
        name,
        key,
        type_id,
        kind,
        config_path: config,
        hooks_key,
        detect_dirs: detect.into_iter().flatten().collect(),
        bin_names: bins,
        window_hints: hints,
    };
    vec![
        host(
            "Claude Code",
            "claude_code",
            "claude-code",
            "settings",
            under(&h, &[".claude", "settings.json"]),
            "hooks",
            vec![under(&h, &[".claude"])],
            &["claude"],
            &["claude", "Claude Code"],
        ),
        host(
            "Claude Desktop",
            "claude_desktop",
            "claude-desktop",
            "settings",
            under(&a, &["Claude", "settings.json"]),
            "hooks",
            vec![under(&a, &["Claude"])],
            &["claude"],
            &["Claude"],
        ),
        host(
            "Codex CLI",
            "codex",
            "codex",
            "codex",
            under(&h, &[".codex", "hooks.json"]),
            "hooks",
            vec![under(&h, &[".codex"])],
            &["codex"],
            &["codex", "Codex"],
        ),
        host(
            "Grok Build",
            "grok_build",
            "grok-build",
            "grok",
            under(&h, &[".grok", "hooks", "winsur.json"]),
            "hooks",
            vec![under(&h, &[".grok"])],
            &["grok"],
            &["grok", "Grok", "xAI"],
        ),
        host(
            "Cursor",
            "cursor",
            "cursor",
            "cursor",
            under(&h, &[".cursor", "hooks.json"]),
            "hooks",
            vec![under(&h, &[".cursor"]), under(&a, &["Cursor"])],
            &["cursor"],
            &["Cursor"],
        ),
        host(
            "Windsurf",
            "windsurf",
            "windsurf",
            "settings",
            under(&a, &["Windsurf", "User", "settings.json"]),
            "hooks",
            vec![under(&a, &["Windsurf"]), under(&h, &[".codeium"])],
            &["windsurf"],
            &["Windsurf"],
        ),
        host(
            "Antigravity",
            "antigravity",
            "antigravity",
            "antigravity",
            under(&h, &[".gemini", "config", "hooks.json"]),
            "winsur",
            vec![
                under(&h, &[".gemini", "antigravity"]),
                under(&h, &[".antigravity"]),
                under(&h, &[".antigravity-ide"]),
                under(&a, &["Antigravity"]),
                under(&a, &["Antigravity IDE"]),
                under(&l, &["Programs", "Antigravity IDE"]),
            ],
            &["antigravity"],
            &["antigravity", "Antigravity"],
        ),
        host(
            "OpenCode",
            "opencode",
            "opencode",
            "opencode",
            under(&h, &[".config", "opencode", "plugins", "winsur.js"]),
            "plugin",
            vec![
                under(&h, &[".config", "opencode"]),
                under(&h, &[".local", "share", "opencode"]),
                under(&h, &[".opencode"]),
            ],
            &["opencode"],
            &["opencode", "OpenCode"],
        ),
        host(
            "Qwen Code",
            "qwen",
            "qwen-code",
            "settings",
            under(&h, &[".qwen", "settings.json"]),
            "hooks",
            vec![under(&h, &[".qwen"]), under(&h, &[".qwen-code"])],
            &["qwen"],
            &["qwen", "Qwen"],
        ),
        host(
            "Gemini CLI",
            "gemini",
            "gemini",
            "settings",
            under(&h, &[".gemini", "settings.json"]),
            "hooks",
            vec![under(&h, &[".gemini"])],
            &["gemini"],
            &["gemini", "Gemini"],
        ),
        host(
            "ZCode",
            "zcode",
            "zcode",
            "settings",
            under(&h, &[".zcode", "settings.json"]),
            "hooks",
            vec![under(&h, &[".zcode"])],
            &["zcode"],
            &["zcode", "ZCode"],
        ),
        host(
            "Trae",
            "trae",
            "trae",
            "settings",
            under(&a, &["Trae", "config.json"]),
            "hooks",
            vec![under(&a, &["Trae"]), under(&h, &[".trae"])],
            &["trae"],
            &["Trae", "trae"],
        ),
        host(
            "MiMoCode",
            "mimocode",
            "mimocode",
            "settings",
            under(&h, &[".mimocode", "config.json"]),
            "hooks",
            vec![under(&h, &[".mimocode"])],
            &["mimocode"],
            &["mimocode", "MiMo"],
        ),
        host(
            "Droid",
            "droid",
            "droid",
            "settings",
            under(&h, &[".droid", "config.json"]),
            "hooks",
            vec![under(&h, &[".droid"]), under(&h, &[".factory"])],
            &["droid"],
            &["droid", "Droid", "Factory"],
        ),
        host(
            "Qoder",
            "qoder",
            "qoder",
            "settings",
            under(&h, &[".qoder", "config.json"]),
            "hooks",
            vec![under(&h, &[".qoder"])],
            &["qoder"],
            &["qoder", "Qoder"],
        ),
        host(
            "Kimi Code",
            "kimi",
            "kimi",
            "settings",
            under(&h, &[".kimi", "settings.json"]),
            "hooks",
            vec![under(&h, &[".kimi"]), under(&h, &[".moonshot"])],
            &["kimi"],
            &["kimi", "Kimi", "Moonshot"],
        ),
        host(
            "DeepSeek",
            "deepseek",
            "deepseek",
            "settings",
            under(&h, &[".deepseek", "settings.json"]),
            "hooks",
            vec![under(&h, &[".deepseek"])],
            &["deepseek"],
            &["deepseek", "DeepSeek"],
        ),
        host(
            "Mistral Vibe",
            "mistral",
            "mistral",
            "settings",
            under(&h, &[".mistral", "config.json"]),
            "hooks",
            vec![under(&h, &[".mistral"]), under(&h, &[".vibe"])],
            &["vibe"],
            &["mistral", "Mistral", "vibe"],
        ),
        host(
            "GitHub Copilot",
            "copilot",
            "copilot",
            "settings",
            under(&a, &["GitHub Copilot", "config.json"]),
            "hooks",
            vec![under(&a, &["GitHub Copilot"]), under(&h, &[".copilot"])],
            &["github-copilot-cli"],
            &["Copilot", "Visual Studio Code"],
        ),
        host(
            "CodeBuddy",
            "codebuddy",
            "code-buddy",
            "settings",
            under(&h, &[".codebuddy", "config.json"]),
            "hooks",
            vec![under(&h, &[".codebuddy"])],
            &["codebuddy"],
            &["codebuddy", "CodeBuddy"],
        ),
        host(
            "WorkBuddy",
            "workbuddy",
            "workbuddy",
            "settings",
            under(&h, &[".workbuddy", "config.json"]),
            "hooks",
            vec![under(&h, &[".workbuddy"])],
            &["workbuddy"],
            &["workbuddy", "WorkBuddy"],
        ),
        host(
            "Kiro",
            "kiro",
            "kiro",
            "settings",
            under(&h, &[".kiro", "config.json"]),
            "hooks",
            vec![under(&h, &[".kiro"]), under(&a, &["Kiro"])],
            &["kiro"],
            &["kiro", "Kiro"],
        ),
        host(
            "Hermes",
            "hermes",
            "hermes",
            "hermes",
            under(&l, &["hermes", "plugins", "winsur", "__init__.py"]),
            "hooks",
            vec![
                under(&l, &["hermes"]),
                under(&h, &[".hermes"]),
                under(&a, &["Hermes"]),
            ],
            &["hermes"],
            &["hermes", "Hermes"],
        ),
        host(
            "Amp",
            "amp",
            "amp",
            "settings",
            under(&h, &[".amp", "config.json"]),
            "hooks",
            vec![under(&h, &[".amp"]), under(&h, &[".sourcegraph"])],
            &["amp"],
            &["amp", "Amp", "Sourcegraph"],
        ),
        host(
            "Pi Agent",
            "pi",
            "pi-agent",
            "settings",
            under(&h, &[".pi", "config.json"]),
            "hooks",
            vec![under(&h, &[".pi"]), under(&h, &[".pi-agent"])],
            &["pi"],
            &["pi", "Pi Agent"],
        ),
        host(
            "Oh My Pi",
            "oh_my_pi",
            "oh-my-pi",
            "settings",
            under(&h, &[".oh-my-pi", "config.json"]),
            "hooks",
            vec![under(&h, &[".oh-my-pi"])],
            &[],
            &["oh my pi", "Oh My Pi"],
        ),
        host(
            "Gajae Code",
            "gajae",
            "gajae",
            "settings",
            under(&h, &[".gajae", "config.json"]),
            "hooks",
            vec![under(&h, &[".gajae"])],
            &[],
            &["gajae", "Gajae"],
        ),
    ]
}

pub fn terminal_hints() -> &'static [&'static str] {
    &[
        "Windows Terminal",
        "Terminal",
        "wt",
        "cmd",
        "powershell",
        "pwsh",
        "WezTerm",
        "wezterm",
        "Alacritty",
        "Kitty",
        "Hyper",
        "ConEmu",
        "Cmder",
        "Fluent Terminal",
        "Tabby",
        "VS Code",
        "Code",
        "Cursor",
        "Windsurf",
        "Visual Studio Code",
        "Warp",
        "Ghostty",
    ]
}

pub fn find_bin_in_path(bin_names: &[&str]) -> bool {
    if bin_names.is_empty() {
        return false;
    }
    let path_env = std::env::var("PATH").unwrap_or_default();
    let mut dirs: Vec<PathBuf> = std::env::split_paths(&path_env).collect();
    if let Some(appdata) = std::env::var_os("APPDATA") {
        let npm = PathBuf::from(appdata).join("npm");
        if !dirs.contains(&npm) {
            dirs.push(npm);
        }
    }
    let exts = if cfg!(windows) {
        vec![".exe", ".cmd", ".ps1", ".bat", ""]
    } else {
        vec![""]
    };
    for bin in bin_names {
        for dir in &dirs {
            for ext in &exts {
                if dir.join(format!("{bin}{ext}")).exists() {
                    return true;
                }
            }
        }
    }
    false
}

pub fn is_detected(host: &AgentHost) -> bool {
    if host.config_path.as_ref().is_some_and(|p| p.exists()) {
        return true;
    }
    if host.detect_dirs.iter().any(|d| d.exists()) {
        return true;
    }
    find_bin_in_path(host.bin_names)
}
