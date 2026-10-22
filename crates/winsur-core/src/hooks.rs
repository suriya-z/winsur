//! Zero-config hook installer. Existing user hooks are preserved.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::registry::{is_detected, registry, AgentHost};

pub const HOOK_URL: &str = "http://127.0.0.1:18900/hooks/event";
pub const PERMISSION_URL: &str = "http://127.0.0.1:18900/hooks/permission";
const GATED_TOOLS: &str = "Bash|Write|Edit|NotebookEdit";
const PERMISSION_TIMEOUT_SEC: u32 = 310;
const EVENT_TIMEOUT_SEC: u32 = 5;
const HOOK_EVENTS: &[&str] = &[
    "PreToolUse",
    "PostToolUse",
    "Notification",
    "Stop",
    "SessionStart",
    "SessionEnd",
];

fn read_json(path: &Path) -> Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| json!({}))
}

fn write_json(path: &Path, value: &Value) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(
        path,
        serde_json::to_string_pretty(value).unwrap_or_else(|_| "{}".into()),
    )
}

pub fn hook_command(script_path: &str, event_name: &str, host_type_id: &str) -> String {
    let suffix = if host_type_id.is_empty() {
        String::new()
    } else {
        format!(" {host_type_id}")
    };
    if script_path.contains(' ') {
        format!("powershell -ExecutionPolicy Bypass -NoProfile -Command \"& '{script_path}' {event_name}{suffix}\"")
    } else {
        format!("powershell -ExecutionPolicy Bypass -NoProfile -File {script_path} {event_name}{suffix}")
    }
}

pub fn is_winsur_handler(handler: &Value) -> bool {
    let cmd = handler
        .get("command")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let cmd_win = handler
        .get("commandWindows")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let url = handler.get("url").and_then(|v| v.as_str()).unwrap_or("");
    cmd.contains("vibe-island")
        || cmd.contains("winsur-hook")
        || cmd_win.contains("winsur-hook")
        || url.contains("18900")
}

pub fn strip_winsur_hooks(groups: &Value) -> Vec<Value> {
    let Some(groups) = groups.as_array() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for group in groups {
        let Some(obj) = group.as_object() else {
            continue;
        };
        if !obj.get("hooks").is_some_and(|v| v.is_array()) {
            if !is_winsur_handler(group) {
                out.push(group.clone());
            }
            continue;
        }
        let kept: Vec<Value> = obj
            .get("hooks")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
            .filter(|h| !is_winsur_handler(h))
            .cloned()
            .collect();
        if !kept.is_empty() {
            let mut next = obj.clone();
            next.insert("hooks".into(), Value::Array(kept));
            out.push(Value::Object(next));
        }
    }
    out
}

pub fn build_http_hooks(gate: bool) -> Value {
    let relay = json!({ "type": "http", "url": HOOK_URL, "timeout": EVENT_TIMEOUT_SEC });
    let mut hooks = serde_json::Map::new();
    for e in HOOK_EVENTS {
        hooks.insert((*e).to_string(), json!([{ "hooks": [relay.clone()] }]));
    }
    if gate {
        let gated = json!({
            "matcher": GATED_TOOLS,
            "hooks": [{ "type": "http", "url": PERMISSION_URL, "timeout": PERMISSION_TIMEOUT_SEC }]
        });
        if let Some(pre) = hooks.get_mut("PreToolUse").and_then(|v| v.as_array_mut()) {
            pre.insert(0, gated);
        }
    }
    Value::Object(hooks)
}

pub fn build_command_hooks(script_path: &str, host_type_id: &str) -> Value {
    let mut hooks = serde_json::Map::new();
    for e in HOOK_EVENTS {
        let cmd = hook_command(script_path, e, host_type_id);
        hooks.insert(
            (*e).to_string(),
            json!([{ "hooks": [{ "type": "command", "command": cmd, "commandWindows": cmd }] }]),
        );
    }
    Value::Object(hooks)
}

fn build_grok_hook_file() -> Value {
    let relay =
        || json!({ "hooks": [{ "type": "http", "url": HOOK_URL, "timeout": EVENT_TIMEOUT_SEC }] });
    json!({
        "hooks": {
            "SessionStart": [relay()],
            "UserPromptSubmit": [relay()],
            "PreToolUse": [relay()],
            "PostToolUse": [relay()],
            "PostToolUseFailure": [relay()],
            "Stop": [relay()],
            "Notification": [relay()],
            "SubagentStart": [relay()],
            "SubagentStop": [relay()],
            "SessionEnd": [relay()]
        }
    })
}

fn install_grok_hooks(config_path: &Path) -> std::io::Result<()> {
    write_json(config_path, &build_grok_hook_file())?;
    if let Some(dir) = config_path.parent() {
        let legacy = dir.join("vibe-island.json");
        if legacy.exists() {
            let _ = fs::remove_file(legacy);
        }
    }
    Ok(())
}

pub fn cursor_hook_command(script_path: &str, event_name: &str) -> String {
    let quoted = script_path.replace('\'', "''");
    format!("$input | & '{quoted}' {event_name} cursor")
}

pub fn build_cursor_hooks(hook_script: &str) -> Value {
    let events = [
        "sessionStart",
        "sessionEnd",
        "beforeSubmitPrompt",
        "postToolUse",
        "postToolUseFailure",
        "stop",
        "subagentStop",
        "afterAgentResponse",
        "afterAgentThought",
        "workspaceOpen",
    ];
    let mut hooks = serde_json::Map::new();
    for ev in events {
        hooks.insert(ev.into(), json!([{ "command": cursor_hook_command(hook_script, ev), "timeout": EVENT_TIMEOUT_SEC }]));
    }
    Value::Object(hooks)
}

pub fn install_cursor_hooks(config_path: &Path, hook_script: &str) -> std::io::Result<()> {
    let mut existing = read_json(config_path);
    if !existing.get("hooks").is_some_and(|v| v.is_object()) {
        existing["hooks"] = json!({});
    }
    if let Some(hooks) = existing.get_mut("hooks").and_then(|v| v.as_object_mut()) {
        let keys: Vec<String> = hooks.keys().cloned().collect();
        for key in keys {
            let kept = strip_winsur_hooks(hooks.get(&key).unwrap_or(&Value::Null));
            if kept.is_empty() {
                hooks.remove(&key);
            } else {
                hooks.insert(key, Value::Array(kept));
            }
        }
        let command_hooks = build_cursor_hooks(hook_script);
        if let Some(obj) = command_hooks.as_object() {
            for (ev, handlers) in obj {
                let kept = strip_winsur_hooks(hooks.get(ev).unwrap_or(&Value::Null));
                let mut merged = kept;
                if let Some(extra) = handlers.as_array() {
                    merged.extend(extra.iter().cloned());
                }
                hooks.insert(ev.clone(), Value::Array(merged));
            }
        }
    }
    if existing.get("version").is_none() || existing["version"].is_null() {
        existing["version"] = json!(1);
    }
    write_json(config_path, &existing)
}

fn install_codex_hooks(config_path: &Path, hook_script: &str) -> std::io::Result<()> {
    let mut existing = read_json(config_path);
    if !existing.get("hooks").is_some_and(|v| v.is_object()) {
        existing["hooks"] = json!({});
    }
    let events = [
        "SessionStart",
        "UserPromptSubmit",
        "PreToolUse",
        "PostToolUse",
        "Stop",
        "SessionEnd",
    ];
    if let Some(hooks) = existing.get_mut("hooks").and_then(|v| v.as_object_mut()) {
        for ev in events {
            let cmd = hook_command(hook_script, ev, "codex");
            let group = json!({
                "hooks": [{ "type": "command", "command": cmd, "commandWindows": cmd, "timeout": EVENT_TIMEOUT_SEC }]
            });
            let mut kept = strip_winsur_hooks(hooks.get(ev).unwrap_or(&Value::Null));
            kept.push(group);
            hooks.insert(ev.into(), Value::Array(kept));
        }
    }
    write_json(config_path, &existing)
}

fn install_antigravity_hooks(config_path: &Path, hook_script: &str) -> std::io::Result<()> {
    let mut existing = read_json(config_path);
    let cmd = |ev: &str| hook_command(hook_script, ev, "antigravity");
    existing["winsur"] = json!({
        "PreToolUse": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": cmd("PreToolUse") }] }],
        "PostToolUse": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": cmd("PostToolUse") }] }],
        "PreInvocation": [{ "type": "command", "command": cmd("SessionStart") }],
        "Stop": [{ "type": "command", "command": cmd("Stop") }]
    });
    write_json(config_path, &existing)
}

fn uninstall_antigravity_hooks(config_path: &Path) {
    if !config_path.exists() {
        return;
    }
    let mut existing = read_json(config_path);
    if existing.get("winsur").is_some() {
        existing.as_object_mut().map(|o| o.remove("winsur"));
        let _ = write_json(config_path, &existing);
    }
}

fn install_opencode_hooks(plugin_file: &Path) -> std::io::Result<()> {
    if let Some(dir) = plugin_file.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::write(plugin_file, include_str!("../templates/opencode.js"))?;
    let Some(config_dir) = plugin_file.parent().and_then(|p| p.parent()) else {
        return Ok(());
    };
    let jsonc = config_dir.join("opencode.jsonc");
    if jsonc.exists() {
        if let Some(mut parsed) = fs::read_to_string(&jsonc)
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        {
            let file_url = format!(
                "file:///{}",
                plugin_file.to_string_lossy().replace('\\', "/")
            );
            if let Some(arr) = parsed.get_mut("plugin").and_then(|v| v.as_array_mut()) {
                if !arr
                    .iter()
                    .any(|p| p.as_str().unwrap_or("").contains("winsur"))
                {
                    arr.push(json!(file_url));
                    let _ = write_json(&jsonc, &parsed);
                }
            } else if parsed.as_object().is_some() {
                parsed["plugin"] = json!([file_url]);
                let _ = write_json(&jsonc, &parsed);
            }
        }
    }
    Ok(())
}

fn uninstall_opencode_hooks(plugin_file: &Path) {
    let _ = fs::remove_file(plugin_file);
    let Some(config_dir) = plugin_file.parent().and_then(|p| p.parent()) else {
        return;
    };
    let jsonc = config_dir.join("opencode.jsonc");
    if let Some(mut parsed) = fs::read_to_string(&jsonc)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
    {
        if let Some(arr) = parsed.get_mut("plugin").and_then(|v| v.as_array_mut()) {
            arr.retain(|p| !p.as_str().unwrap_or("").contains("winsur"));
            let _ = write_json(&jsonc, &parsed);
        }
    }
}

fn ensure_hermes_yaml(hermes_home: &Path) {
    let cfg = hermes_home.join("config.yaml");
    if !cfg.exists() {
        return;
    }
    let Ok(mut text) = fs::read_to_string(&cfg) else {
        return;
    };
    if text.contains("- winsur") || text.contains("\"winsur\"") {
        return;
    }
    if text.lines().any(|l| l.trim() == "plugins:") {
        text = text.replace("plugins:", "plugins:\n  enabled:\n    - winsur");
    } else {
        text.push_str("\nplugins:\n  enabled:\n    - winsur\n");
    }
    let _ = fs::write(cfg, text);
}

fn install_hermes_hooks(plugin_init: &Path) -> std::io::Result<()> {
    let plugin_dir = plugin_init.parent().unwrap_or(Path::new("."));
    let hermes_home = plugin_dir
        .parent()
        .and_then(|p| p.parent())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(plugin_dir)?;
    fs::write(
        plugin_dir.join("plugin.yaml"),
        include_str!("../templates/hermes_plugin.yaml"),
    )?;
    fs::write(plugin_init, include_str!("../templates/hermes_init.py"))?;
    ensure_hermes_yaml(hermes_home);

    let dot = home_dir().join(".hermes");
    if dot.exists() && dot.canonicalize().ok() != hermes_home.canonicalize().ok() {
        let alt = dot.join("plugins").join("winsur");
        fs::create_dir_all(&alt)?;
        fs::write(
            alt.join("plugin.yaml"),
            include_str!("../templates/hermes_plugin.yaml"),
        )?;
        fs::write(
            alt.join("__init__.py"),
            include_str!("../templates/hermes_init.py"),
        )?;
        ensure_hermes_yaml(&dot);
    }
    Ok(())
}

fn uninstall_hermes_hooks(plugin_init: &Path) {
    if let Some(dir) = plugin_init.parent() {
        let _ = fs::remove_dir_all(dir);
    }
}

fn home_dir() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

pub fn install_hooks_to_config(
    config_path: &Path,
    hook_script: &str,
    hooks_key: &str,
    prefer_http: bool,
    gate: bool,
    host_type_id: &str,
) -> std::io::Result<()> {
    let mut settings = if config_path.exists() {
        read_json(config_path)
    } else {
        json!({})
    };
    if !settings.is_object() {
        settings = json!({});
    }
    let hooks = if prefer_http {
        build_http_hooks(gate)
    } else {
        build_command_hooks(hook_script, host_type_id)
    };
    if !settings.get(hooks_key).is_some_and(|v| v.is_object()) {
        settings[hooks_key] = json!({});
    }
    if let Some(existing) = settings.get_mut(hooks_key).and_then(|v| v.as_object_mut()) {
        if let Some(obj) = hooks.as_object() {
            for (event_name, groups) in obj {
                let mut kept = strip_winsur_hooks(existing.get(event_name).unwrap_or(&Value::Null));
                if let Some(extra) = groups.as_array() {
                    kept.extend(extra.iter().cloned());
                }
                existing.insert(event_name.clone(), Value::Array(kept));
            }
        }
    }
    write_json(config_path, &settings)
}

fn uninstall_from_config(config_path: &Path, hooks_key: &str) {
    if !config_path.exists() {
        return;
    }
    let mut settings = read_json(config_path);
    let Some(existing) = settings.get_mut(hooks_key).and_then(|v| v.as_object_mut()) else {
        return;
    };
    let keys: Vec<String> = existing.keys().cloned().collect();
    for event_name in keys {
        let kept = strip_winsur_hooks(existing.get(&event_name).unwrap_or(&Value::Null));
        existing.insert(event_name, Value::Array(kept));
    }
    let _ = write_json(config_path, &settings);
}

pub fn resolve_hook_script(resource_dir: Option<&Path>) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(dir) = resource_dir {
        candidates.push(dir.join("winsur-hook.ps1"));
        candidates.push(dir.join("hooks").join("winsur-hook.ps1"));
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../hooks/winsur-hook.ps1"));
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("hooks").join("winsur-hook.ps1"));
    }
    candidates.into_iter().find(|p| p.exists())
}

pub fn install_all_hooks(hook_script: &Path) -> Result<String, String> {
    let script = hook_script.to_string_lossy().to_string();
    let mut installed = Vec::new();
    let mut skipped = Vec::new();
    let mut errors = Vec::new();
    for host in registry() {
        let Some(config) = host.config_path.clone() else {
            skipped.push(host.name.to_string());
            continue;
        };
        if !is_detected(&host) {
            skipped.push(host.name.to_string());
            continue;
        }
        let result = install_one(&host, &config, &script);
        match result {
            Ok(()) => installed.push(host.name.to_string()),
            Err(e) => errors.push(format!("{}: {e}", host.name)),
        }
    }
    let mut parts = Vec::new();
    if !installed.is_empty() {
        parts.push(format!("Installed: {}", installed.join(", ")));
    }
    if !skipped.is_empty() {
        let shown: Vec<_> = skipped.iter().take(8).cloned().collect();
        let more = if skipped.len() > 8 { "..." } else { "" };
        parts.push(format!(
            "Not detected ({}): {}{more}",
            skipped.len(),
            shown.join(", ")
        ));
    }
    if !errors.is_empty() {
        parts.push(format!("Failed: {}", errors.join("; ")));
    }
    let msg = if parts.is_empty() {
        "Nothing to install".into()
    } else {
        parts.join("\n")
    };
    if installed.is_empty() && !errors.is_empty() {
        return Err(msg);
    }
    Ok(msg)
}

fn install_one(host: &AgentHost, config: &Path, script: &str) -> std::io::Result<()> {
    match host.kind {
        "grok" => install_grok_hooks(config),
        "cursor" => install_cursor_hooks(config, script),
        "codex" => install_codex_hooks(config, script),
        "antigravity" => install_antigravity_hooks(config, script),
        "opencode" => install_opencode_hooks(config),
        "hermes" => install_hermes_hooks(config),
        _ => {
            let prefer_http = host.key == "claude_code"
                || host.key == "claude_desktop"
                || host.type_id == "claude-code";
            let gate = host.key == "claude_code";
            install_hooks_to_config(
                config,
                script,
                host.hooks_key,
                prefer_http,
                gate,
                host.type_id,
            )
        }
    }
}

pub fn uninstall_all_hooks() -> String {
    let mut uninstalled = Vec::new();
    for host in registry() {
        let Some(config) = host.config_path.clone() else {
            continue;
        };
        match host.kind {
            "grok" => {
                if config.exists() && fs::remove_file(&config).is_ok() {
                    uninstalled.push(host.name.to_string());
                }
            }
            "antigravity" => {
                uninstall_antigravity_hooks(&config);
                uninstalled.push(host.name.to_string());
            }
            "opencode" => {
                uninstall_opencode_hooks(&config);
                uninstalled.push(host.name.to_string());
            }
            "hermes" => {
                uninstall_hermes_hooks(&config);
                uninstalled.push(host.name.to_string());
            }
            _ => {
                uninstall_from_config(&config, host.hooks_key);
                if config.exists() {
                    uninstalled.push(host.name.to_string());
                }
            }
        }
    }
    if uninstalled.is_empty() {
        "No hooks to uninstall".into()
    } else {
        format!("Uninstalled: {}", uninstalled.join(", "))
    }
}

pub fn check_hooks_status(hook_script: Option<&Path>) -> Value {
    let mut status = serde_json::Map::new();
    let hosts = registry();
    let count = hosts.len();
    for host in hosts {
        let mut entry = json!({
            "installed": false,
            "detected": is_detected(&host),
            "path": host.config_path.as_ref().map(|p| p.to_string_lossy().to_string()),
            "name": host.name,
            "typeId": host.type_id
        });
        if let Some(path) = &host.config_path {
            if let Ok(content) = fs::read_to_string(path) {
                let installed = content.contains("vibe-island")
                    || content.contains("winsur-hook")
                    || content.contains("winsur.json")
                    || content.contains("18900")
                    || content.contains("Winsur");
                entry["installed"] = json!(installed);
            }
        }
        status.insert(host.key.to_string(), entry);
    }
    status.insert(
        "hook_script".into(),
        json!(hook_script.map(|p| p.to_string_lossy().to_string())),
    );
    status.insert("agent_count".into(), json!(count));
    Value::Object(status)
}

pub fn auto_install_on_launch(hook_script: &Path) -> String {
    match install_all_hooks(hook_script) {
        Ok(msg) => msg,
        Err(msg) => msg,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_hooks_use_the_flat_camel_case_schema_and_replace_older_nested_entries() {
        let hooks = build_cursor_hooks(r"C:\tools\winsur-hook.ps1");
        let cmd = hooks["sessionStart"][0]["command"].as_str().unwrap();
        assert!(cmd.contains("sessionStart cursor"));
        assert!(cmd.starts_with("$input | &"));
        assert!(hooks.get("PreToolUse").is_none());
        assert!(hooks.get("preToolUse").is_none());
        let legacy = json!([
            { "hooks": [{ "type": "command", "command": "powershell -File winsur-hook.ps1 SessionStart cursor" }] },
            { "command": "echo keep-me" }
        ]);
        let kept = strip_winsur_hooks(&legacy);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0]["command"], "echo keep-me");
    }

    #[test]
    fn install_cursor_hooks_keeps_a_user_command() {
        let dir = std::env::temp_dir().join(format!("winsur-hooks-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("hooks.json");
        fs::write(
            &path,
            r#"{"hooks":{"sessionStart":[{"command":"echo keep-me"}]}}"#,
        )
        .unwrap();
        install_cursor_hooks(&path, r"C:\tools\winsur-hook.ps1").unwrap();
        let v: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let cmds: Vec<&str> = v["hooks"]["sessionStart"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|h| h["command"].as_str())
            .collect();
        assert!(cmds.contains(&"echo keep-me"));
        assert!(cmds
            .iter()
            .any(|c| c.contains("winsur-hook.ps1") && c.starts_with("$input | &")));
        let _ = fs::remove_dir_all(&dir);
    }
}
