//! Find agent sessions that are already running when Winsur starts.

use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde_json::Value;

pub const MAX_AGE_MS: i64 = 12 * 60 * 60 * 1000;
pub const RECENT_ACTIVE_MS: i64 = 2 * 60 * 1000;
const CAP_PER_TYPE: usize = 4;

#[derive(Clone, Debug)]
pub struct ProcessInfo {
    pub pid: u32,
    pub parent_pid: u32,
    pub name: String,
    pub command_line: String,
    pub executable_path: String,
}

#[derive(Clone, Debug)]
pub struct Artifact {
    pub agent_type: String,
    pub cwd: String,
    pub mtime: i64,
}

#[derive(Clone, Debug)]
pub struct PlannedSession {
    pub id: String,
    pub agent_type: String,
    pub cwd: String,
    pub name: String,
    pub pid: Option<u32>,
    pub last_event_at: String,
    pub status: String,
}

#[derive(Clone, Debug)]
pub struct DiscoveryPlan {
    pub sessions: Vec<PlannedSession>,
    pub pids: Vec<u32>,
    pub types: Vec<String>,
}

fn name_map(name: &str) -> Option<&'static str> {
    Some(match name {
        "windsurf" => "windsurf",
        "gemini" => "gemini",
        "qwen" => "qwen-code",
        "opencode" => "opencode",
        "kiro" => "kiro",
        "hermes" => "hermes",
        "trae" => "trae",
        "codebuddy" => "code-buddy",
        "antigravity" => "antigravity",
        "droid" => "droid",
        "kimi" => "kimi",
        "deepseek" => "deepseek",
        "amp" => "amp",
        "mistral" | "vibe" => "mistral",
        "zcode" => "zcode",
        "qoder" => "qoder",
        "mimocode" => "mimocode",
        "workbuddy" => "workbuddy",
        "gajae" => "gajae",
        _ => return None,
    })
}

pub fn label(type_id: &str) -> &str {
    match type_id {
        "claude-code" => "Claude",
        "claude-desktop" => "Claude App",
        "codex" => "Codex",
        "cursor" => "Cursor",
        "grok-build" => "Grok Build",
        "windsurf" => "Windsurf",
        "gemini" => "Gemini",
        "qwen-code" => "Qwen",
        "opencode" => "OpenCode",
        "kiro" => "Kiro",
        "hermes" => "Hermes",
        "trae" => "Trae",
        "code-buddy" => "CodeBuddy",
        "antigravity" => "Antigravity",
        "droid" => "Droid",
        "kimi" => "Kimi",
        "deepseek" => "DeepSeek",
        "amp" => "Amp",
        "mistral" => "Mistral",
        "zcode" => "ZCode",
        "qoder" => "Qoder",
        "mimocode" => "MiMo",
        "workbuddy" => "WorkBuddy",
        "gajae" => "Gajae",
        _ => type_id,
    }
}

pub fn norm_cwd(cwd: &str) -> String {
    crate::agent::norm_cwd(cwd)
}

fn base_name(cwd: &str) -> String {
    cwd.split(['/', '\\'])
        .rfind(|p| !p.is_empty())
        .unwrap_or("")
        .to_string()
}

pub fn is_helper_process(proc: &ProcessInfo) -> bool {
    let name = proc.name.to_lowercase();
    let cmd = proc.command_line.to_lowercase();
    if cmd.contains("--type=") {
        return true;
    }
    if name.contains("helper") || name.contains("crashpad") || name.contains("crashhandler") {
        return true;
    }
    if name.contains("gpu-process") || name.ends_with(" gpu") || name.contains("utility") {
        return true;
    }
    false
}

fn exe_name(name: &str) -> String {
    let lower = name.to_lowercase();
    lower.strip_suffix(".exe").unwrap_or(&lower).to_string()
}

fn path_has_exe(blob: &str, exe: &str) -> bool {
    for sep in ['\\', '/'] {
        let needle = format!("{sep}{exe}");
        if let Some(idx) = blob.find(&needle) {
            let after = idx + needle.len();
            let next = blob.as_bytes().get(after).copied();
            if next.is_none() || next == Some(b' ') || next == Some(b'"') {
                return true;
            }
        }
    }
    false
}

pub fn classify_process(proc: &ProcessInfo) -> Option<&'static str> {
    if is_helper_process(proc) {
        return None;
    }
    let name = exe_name(&proc.name);
    let blob = format!(
        "{} {} {}",
        proc.name, proc.executable_path, proc.command_line
    )
    .to_lowercase();

    if name == "cursor" || path_has_exe(&blob, "cursor.exe") {
        return Some("cursor");
    }
    if name == "windsurf" || path_has_exe(&blob, "windsurf.exe") {
        return Some("windsurf");
    }
    if name == "codex"
        || path_has_exe(&blob, "codex.exe")
        || blob.contains("@openai/codex")
        || blob.contains("@openai\\codex")
        || blob.contains("codex-cli")
    {
        return Some("codex");
    }
    if name == "grok" || path_has_exe(&blob, "grok.exe") {
        return Some("grok-build");
    }
    if blob.contains("claude-code")
        || blob.contains("@anthropic-ai")
        || blob.contains("@anthropic-ai\\claude")
    {
        return Some("claude-code");
    }
    if name == "claude" {
        if blob.contains("anthropicclaude")
            || blob.contains("\\programs\\claude\\")
            || blob.contains("/programs/claude/")
        {
            return Some("claude-desktop");
        }
        return Some("claude-code");
    }
    if name == "node" || name == "nodejs" {
        if blob.contains("claude-code") || blob.contains("@anthropic-ai") {
            return Some("claude-code");
        }
        if blob.contains("@openai/codex")
            || blob.contains("codex-cli")
            || blob.contains("\\codex\\")
            || blob.contains("/codex/")
        {
            return Some("codex");
        }
        if blob.contains("gemini-cli") || blob.contains("@google/gemini") {
            return Some("gemini");
        }
        if blob.contains("qwen-code") || blob.contains("@qwen") {
            return Some("qwen-code");
        }
        return None;
    }
    name_map(&name)
}

fn extract_json_string(text: &str, key: &str) -> String {
    let pattern = format!("\"{key}\"");
    let Some(idx) = text.find(&pattern) else {
        return String::new();
    };
    let rest = text[idx + pattern.len()..].trim_start();
    let Some(rest) = rest.strip_prefix(':') else {
        return String::new();
    };
    let rest = rest.trim_start();
    if !rest.starts_with('"') {
        return String::new();
    }
    let bytes = rest.as_bytes();
    let mut end = 1;
    let mut escaped = false;
    while end < bytes.len() {
        if escaped {
            escaped = false;
            end += 1;
            continue;
        }
        if bytes[end] == b'\\' {
            escaped = true;
            end += 1;
            continue;
        }
        if bytes[end] == b'"' {
            break;
        }
        end += 1;
    }
    if end >= bytes.len() {
        return String::new();
    }
    serde_json::from_str::<String>(&rest[..=end]).unwrap_or_default()
}

pub fn extract_cwd(text: &str) -> String {
    for key in ["cwd", "workspaceRoot", "workspace_root"] {
        let value = extract_json_string(text, key);
        if !value.is_empty() {
            return value;
        }
    }
    String::new()
}

fn read_head(path: &Path) -> String {
    let Ok(mut file) = File::open(path) else {
        return String::new();
    };
    let mut buf = vec![0u8; 65536];
    let Ok(n) = file.read(&mut buf) else {
        return String::new();
    };
    String::from_utf8_lossy(&buf[..n]).into_owned()
}

fn mtime_ms(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) =
                u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""), 16)
            {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn file_uri_to_path(uri: &str) -> String {
    if uri.is_empty() {
        return String::new();
    }
    if !uri.to_ascii_lowercase().starts_with("file:") {
        return uri.to_string();
    }
    let Ok(url) = url::Url::parse(uri) else {
        return String::new();
    };
    // The url crate leaves `%3A` encoded in file paths. WHATWG `new URL` decodes it,
    // which is what the Electron discovery code did.
    let mut p = percent_decode(url.path());
    let b = p.as_bytes();
    if b.len() >= 3 && b[0] == b'/' && b[1].is_ascii_alphabetic() && b[2] == b':' {
        p.remove(0);
    }
    p
}

fn list_dir(dir: &Path) -> Vec<fs::DirEntry> {
    fs::read_dir(dir)
        .map(|rd| rd.filter_map(|e| e.ok()).collect())
        .unwrap_or_default()
}

fn collect_claude(home: &Path, out: &mut Vec<Artifact>) {
    let root = home.join(".claude").join("projects");
    let mut ranked = Vec::new();
    for ent in list_dir(&root) {
        if !ent.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let dir = ent.path();
        let mut best: Option<(i64, PathBuf)> = None;
        for child in list_dir(&dir) {
            let name = child.file_name();
            let name = name.to_string_lossy();
            if !(name.to_lowercase().ends_with(".jsonl") || name.to_lowercase().ends_with(".json"))
            {
                continue;
            }
            let fp = child.path();
            let m = mtime_ms(&fp);
            if best.as_ref().is_none_or(|(bm, _)| m > *bm) {
                best = Some((m, fp));
            }
        }
        if let Some(best) = best {
            ranked.push(best);
        }
    }
    ranked.sort_by_key(|item| std::cmp::Reverse(item.0));
    for (m, fp) in ranked.into_iter().take(12) {
        let cwd = extract_cwd(&read_head(&fp));
        if cwd.is_empty() {
            continue;
        }
        out.push(Artifact {
            agent_type: "claude-code".into(),
            cwd,
            mtime: m,
        });
    }
}

fn walk_files(
    root: &Path,
    max_depth: usize,
    max_files: usize,
    accept: impl Fn(&str) -> bool,
) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        if found.len() >= max_files {
            break;
        }
        for ent in list_dir(&dir) {
            if found.len() >= max_files {
                break;
            }
            let name = ent.file_name();
            let name = name.to_string_lossy();
            if name == "node_modules" || name == "cache" || name == ".git" {
                continue;
            }
            let fp = ent.path();
            let is_dir = ent.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if is_dir {
                if depth < max_depth {
                    stack.push((fp, depth + 1));
                }
            } else if accept(&name) {
                found.push(fp);
            }
        }
    }
    found
}

fn collect_jsonl_cwds(root: &Path, agent_type: &str, out: &mut Vec<Artifact>, max_depth: usize) {
    if !root.exists() {
        return;
    }
    let files = walk_files(root, max_depth, 80, |name| {
        let n = name.to_lowercase();
        n.ends_with(".jsonl") || n.ends_with(".json")
    });
    let mut ranked: Vec<(i64, PathBuf)> = files.into_iter().map(|fp| (mtime_ms(&fp), fp)).collect();
    ranked.sort_by_key(|item| std::cmp::Reverse(item.0));
    for (m, fp) in ranked.into_iter().take(12) {
        let cwd = extract_cwd(&read_head(&fp));
        if cwd.is_empty() {
            continue;
        }
        out.push(Artifact {
            agent_type: agent_type.into(),
            cwd,
            mtime: m,
        });
    }
}

fn collect_workspace_storage(
    appdata: &Path,
    product: &str,
    agent_type: &str,
    out: &mut Vec<Artifact>,
) {
    let root = appdata.join(product).join("User").join("workspaceStorage");
    let mut ranked = Vec::new();
    for ent in list_dir(&root) {
        if !ent.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let fp = ent.path().join("workspace.json");
        if fp.exists() {
            ranked.push((mtime_ms(&fp), fp));
        }
    }
    ranked.sort_by_key(|item| std::cmp::Reverse(item.0));
    for (m, fp) in ranked.into_iter().take(12) {
        let parsed: Option<Value> = fs::read_to_string(&fp)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok());
        let raw = parsed
            .as_ref()
            .and_then(|v| v.get("folder").or_else(|| v.get("workspace")))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let cwd = file_uri_to_path(raw);
        if cwd.is_empty() {
            continue;
        }
        out.push(Artifact {
            agent_type: agent_type.into(),
            cwd,
            mtime: m,
        });
    }
}

pub fn collect_artifacts(home: &Path, appdata: &Path) -> Vec<Artifact> {
    let mut out = Vec::new();
    if !home.as_os_str().is_empty() {
        collect_claude(home, &mut out);
        collect_jsonl_cwds(&home.join(".codex").join("sessions"), "codex", &mut out, 4);
        collect_jsonl_cwds(&home.join(".grok"), "grok-build", &mut out, 3);
        collect_jsonl_cwds(&home.join(".gemini"), "gemini", &mut out, 3);
        collect_jsonl_cwds(&home.join(".hermes"), "hermes", &mut out, 3);
    }
    if !appdata.as_os_str().is_empty() {
        collect_workspace_storage(appdata, "Cursor", "cursor", &mut out);
        collect_workspace_storage(appdata, "Windsurf", "windsurf", &mut out);
    }
    out
}

fn iso_from_ms(ms: i64) -> String {
    let dt = UNIX_EPOCH + std::time::Duration::from_millis(ms.max(0) as u64);
    chrono::DateTime::<chrono::Utc>::from(dt).to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn plan_discoveries(
    processes: &[ProcessInfo],
    artifacts: &[Artifact],
    now: i64,
) -> DiscoveryPlan {
    let mut typed = Vec::new();
    for proc in processes {
        if let Some(type_id) = classify_process(proc) {
            typed.push((type_id.to_string(), proc.pid));
        }
    }
    let mut types = Vec::new();
    let mut pids = Vec::new();
    for (type_id, pid) in &typed {
        if !types.contains(type_id) {
            types.push(type_id.clone());
        }
        if *pid > 0 && !pids.contains(pid) {
            pids.push(*pid);
        }
    }
    let mut sessions = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for type_id in &types {
        let pid = typed
            .iter()
            .find(|(t, _)| t == type_id)
            .map(|(_, pid)| *pid);
        let mut arts: Vec<&Artifact> = artifacts
            .iter()
            .filter(|a| &a.agent_type == type_id && !a.cwd.is_empty())
            .collect();
        arts.sort_by_key(|art| std::cmp::Reverse(art.mtime));
        let recent: Vec<&Artifact> = arts
            .iter()
            .copied()
            .filter(|a| now - a.mtime <= MAX_AGE_MS)
            .collect();
        let picked: Vec<&Artifact> = if recent.is_empty() {
            arts.into_iter().take(1).collect()
        } else {
            recent.into_iter().take(CAP_PER_TYPE).collect()
        };
        if picked.is_empty() {
            sessions.push(PlannedSession {
                id: format!("live:{type_id}:"),
                agent_type: type_id.clone(),
                cwd: String::new(),
                name: label(type_id).to_string(),
                pid,
                last_event_at: iso_from_ms(now),
                status: "idle".into(),
            });
            continue;
        }
        for art in picked {
            let key = format!("{type_id}|{}", norm_cwd(&art.cwd));
            if !seen.insert(key) {
                continue;
            }
            let age = now - art.mtime;
            sessions.push(PlannedSession {
                id: format!("live:{type_id}:{}", norm_cwd(&art.cwd)),
                agent_type: type_id.clone(),
                cwd: art.cwd.clone(),
                name: {
                    let n = base_name(&art.cwd);
                    if n.is_empty() {
                        label(type_id).to_string()
                    } else {
                        n
                    }
                },
                pid,
                last_event_at: iso_from_ms(art.mtime),
                status: if (0..RECENT_ACTIVE_MS).contains(&age) {
                    "thinking".into()
                } else {
                    "idle".into()
                },
            });
        }
    }
    DiscoveryPlan {
        sessions,
        pids,
        types,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::infer_agent_type;
    use serde_json::json;

    fn proc(name: &str, command_line: &str, executable_path: &str) -> ProcessInfo {
        ProcessInfo {
            pid: 1,
            parent_pid: 0,
            name: name.into(),
            command_line: command_line.into(),
            executable_path: executable_path.into(),
        }
    }

    #[test]
    fn process_classification_and_artifact_discovery() {
        assert_eq!(
            classify_process(&proc(
                "Cursor.exe",
                "Cursor.exe",
                r"C:\Program Files\Cursor\Cursor.exe"
            )),
            Some("cursor")
        );
        assert_eq!(
            classify_process(&proc("Cursor Helper.exe", "Cursor.exe --type=gpu", "")),
            None
        );
        assert_eq!(
            classify_process(&proc(
                "node.exe",
                r"node C:\Users\me\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\cli.js",
                r"C:\Program Files\nodejs\node.exe"
            )),
            Some("claude-code")
        );
        assert_eq!(
            classify_process(&proc(
                "claude.exe",
                "",
                r"C:\Users\me\.local\bin\claude.exe"
            )),
            Some("claude-code")
        );
        assert_eq!(
            classify_process(&proc(
                "Claude.exe",
                "",
                r"C:\Users\me\AppData\Local\Programs\Claude\Claude.exe"
            )),
            Some("claude-desktop")
        );
        assert_eq!(
            classify_process(&proc("codex.exe", "", r"C:\Users\me\.codex\codex.exe")),
            Some("codex")
        );
        assert_eq!(classify_process(&proc("chrome.exe", "", "")), None);
        assert_eq!(
            infer_agent_type(
                &json!({ "cwd": "C:\\projects\\grok-experiments", "session_id": "x", "hook_event_name": "Stop" })
            ),
            "unknown"
        );

        let now = chrono::DateTime::parse_from_rfc3339("2026-10-22T12:00:00.000Z")
            .unwrap()
            .timestamp_millis();
        let planned = plan_discoveries(
            &[
                ProcessInfo {
                    pid: 10,
                    parent_pid: 0,
                    name: "claude.exe".into(),
                    command_line: String::new(),
                    executable_path: r"C:\bin\claude.exe".into(),
                },
                ProcessInfo {
                    pid: 11,
                    parent_pid: 0,
                    name: "Cursor.exe".into(),
                    command_line: String::new(),
                    executable_path: r"C:\Cursor\Cursor.exe".into(),
                },
            ],
            &[
                Artifact {
                    agent_type: "claude-code".into(),
                    cwd: r"C:\work\new".into(),
                    mtime: now - 60 * 1000,
                },
                Artifact {
                    agent_type: "claude-code".into(),
                    cwd: r"C:\work\old".into(),
                    mtime: now - 48 * 60 * 60 * 1000,
                },
                Artifact {
                    agent_type: "cursor".into(),
                    cwd: r"C:\work\editor".into(),
                    mtime: now - 5 * 60 * 1000,
                },
            ],
            now,
        );
        let mut cwds: Vec<String> = planned
            .sessions
            .iter()
            .map(|s| format!("{}:{}", s.agent_type, s.cwd))
            .collect();
        cwds.sort();
        assert_eq!(
            cwds,
            vec![
                r"claude-code:C:\work\new".to_string(),
                r"cursor:C:\work\editor".to_string()
            ]
        );
        assert_eq!(
            planned
                .sessions
                .iter()
                .find(|s| s.agent_type == "claude-code")
                .unwrap()
                .status,
            "thinking"
        );
        assert_eq!(
            file_uri_to_path("file:///c%3A/Users/me/proj"),
            "c:/Users/me/proj"
        );
        assert_eq!(
            extract_cwd(r#"{"cwd":"C:\\work\\app","x":1}"#),
            r"C:\work\app"
        );
    }

    #[test]
    fn collect_artifacts_reads_claude_codex_and_cursor_session_files() {
        let root = std::env::temp_dir().join(format!("winsur-discover-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let home = root.join("home");
        let appdata = root.join("appdata");
        fs::create_dir_all(home.join(".claude").join("projects").join("C--work-app")).unwrap();
        fs::write(
            home.join(".claude")
                .join("projects")
                .join("C--work-app")
                .join("s.jsonl"),
            "{\"cwd\":\"C:\\\\work\\\\app\"}\n",
        )
        .unwrap();
        fs::create_dir_all(
            home.join(".codex")
                .join("sessions")
                .join("2026")
                .join("10")
                .join("22"),
        )
        .unwrap();
        fs::write(
            home.join(".codex")
                .join("sessions")
                .join("2026")
                .join("10")
                .join("22")
                .join("rollout.jsonl"),
            "{\"cwd\":\"D:\\\\codex\\\\repo\"}\n",
        )
        .unwrap();
        let storage = appdata
            .join("Cursor")
            .join("User")
            .join("workspaceStorage")
            .join("abc");
        fs::create_dir_all(&storage).unwrap();
        fs::write(
            storage.join("workspace.json"),
            r#"{"folder":"file:///c%3A/work/editor"}"#,
        )
        .unwrap();

        let arts = collect_artifacts(&home, &appdata);
        let types: Vec<String> = arts
            .iter()
            .map(|a| format!("{}:{}", a.agent_type, a.cwd.replace('/', "\\")))
            .collect();
        assert!(types
            .iter()
            .any(|t| t.starts_with(r"claude-code:C:\work\app")));
        assert!(types.iter().any(|t| t.starts_with(r"codex:D:\codex\repo")));
        assert!(types
            .iter()
            .any(|t| t.contains("cursor:") && t.to_lowercase().contains("work")));
        let _ = fs::remove_dir_all(&root);
    }
}
