//! Local usage / quota readers. Fully local, best-effort.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRow {
    pub id: String,
    pub name: String,
    pub label: String,
    pub used: Option<f64>,
    pub limit: Option<f64>,
    pub remaining: Option<f64>,
    pub resets_at: Option<String>,
    pub detail: String,
    pub ok: bool,
}

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

fn read_json(path: &Path) -> Option<Value> {
    fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
}

fn nested_num(v: &Value, parent: &str, child: &str) -> Option<f64> {
    v.get(parent)
        .and_then(|p| p.get(child))
        .and_then(|x| x.as_f64())
}

fn remaining(used: Option<f64>, limit: Option<f64>) -> Option<f64> {
    match (used, limit) {
        (Some(u), Some(l)) => Some((l - u).max(0.0)),
        _ => None,
    }
}

#[allow(clippy::too_many_arguments)]
fn row(
    id: &str,
    name: &str,
    label: &str,
    used: Option<f64>,
    limit: Option<f64>,
    resets: Option<String>,
    detail: &str,
    ok: bool,
) -> UsageRow {
    UsageRow {
        id: id.into(),
        name: name.into(),
        label: label.into(),
        remaining: remaining(used, limit),
        used,
        limit,
        resets_at: resets,
        detail: detail.into(),
        ok,
    }
}

pub fn collect_usage() -> Vec<UsageRow> {
    let home = home();
    let mut rows = Vec::new();

    {
        let candidates = [
            home.join(".claude").join("stats-cache.json"),
            home.join(".claude").join("usage.json"),
            home.join(".claude").join("session-env.json"),
        ];
        let found = candidates
            .iter()
            .find_map(|p| read_json(p).map(|data| (p.clone(), data)));
        if let Some((path, d)) = found {
            let used = d
                .get("used")
                .and_then(|v| v.as_f64())
                .or_else(|| d.get("tokensUsed").and_then(|v| v.as_f64()))
                .or_else(|| nested_num(&d, "five_hour", "used"));
            let limit = d
                .get("limit")
                .and_then(|v| v.as_f64())
                .or_else(|| d.get("tokensLimit").and_then(|v| v.as_f64()))
                .or_else(|| nested_num(&d, "five_hour", "limit"));
            let resets = d
                .get("resetsAt")
                .and_then(|v| v.as_str())
                .or_else(|| d.get("reset_at").and_then(|v| v.as_str()))
                .or_else(|| d.pointer("/five_hour/resetsAt").and_then(|v| v.as_str()))
                .map(|s| s.to_string());
            rows.push(row(
                "claude",
                "Claude",
                "Claude Code",
                used,
                limit,
                resets,
                &path.to_string_lossy(),
                true,
            ));
        } else {
            rows.push(row(
                "claude",
                "Claude",
                "Claude Code",
                None,
                None,
                None,
                "No local usage file (sign in / use Claude CLI first)",
                false,
            ));
        }
    }

    {
        let j = read_json(&home.join(".codex").join("usage.json"))
            .or_else(|| read_json(&home.join(".codex").join("session.json")));
        if let Some(j) = j {
            let used = j
                .get("used")
                .and_then(|v| v.as_f64())
                .or_else(|| nested_num(&j, "primary_window", "used"));
            let limit = j
                .get("limit")
                .and_then(|v| v.as_f64())
                .or_else(|| nested_num(&j, "primary_window", "limit"));
            let resets = j
                .get("resetsAt")
                .and_then(|v| v.as_str())
                .or_else(|| {
                    j.pointer("/primary_window/resetsAt")
                        .and_then(|v| v.as_str())
                })
                .map(|s| s.to_string());
            rows.push(row(
                "codex",
                "Codex",
                "Codex CLI",
                used,
                limit,
                resets,
                "local codex usage",
                true,
            ));
        } else {
            rows.push(row(
                "codex",
                "Codex",
                "Codex CLI",
                None,
                None,
                None,
                "No local Codex usage file",
                false,
            ));
        }
    }

    for (id, name, label, paths, detail_ok, detail_miss) in [
        (
            "kimi",
            "Kimi",
            "Kimi Code",
            vec![
                home.join(".kimi").join("usage.json"),
                home.join(".moonshot").join("usage.json"),
            ],
            "local kimi usage",
            "No local Kimi usage file",
        ),
        (
            "deepseek",
            "DeepSeek",
            "DeepSeek",
            vec![home.join(".deepseek").join("usage.json")],
            "local deepseek usage",
            "No local DeepSeek usage file",
        ),
        (
            "glm",
            "GLM",
            "GLM",
            vec![
                home.join(".glm").join("usage.json"),
                home.join(".zhipu").join("usage.json"),
            ],
            "local glm usage",
            "No local GLM usage file",
        ),
    ] {
        let j = paths.iter().find_map(|p| read_json(p));
        if let Some(j) = j {
            let used = j.get("used").and_then(|v| v.as_f64());
            let limit = j.get("limit").and_then(|v| v.as_f64());
            let resets = j
                .get("resetsAt")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let mut item = row(id, name, label, used, limit, resets, detail_ok, true);
            item.remaining = match (used, limit) {
                (Some(used), Some(limit)) => Some(limit - used),
                _ => None,
            };
            rows.push(item);
        } else {
            rows.push(row(id, name, label, None, None, None, detail_miss, false));
        }
    }

    {
        let auth = read_json(&home.join(".grok").join("auth.json"));
        rows.push(row(
            "grok",
            "Grok",
            "Grok Build",
            None,
            None,
            None,
            if auth.is_some() {
                "Signed in locally (quota not exposed in files)"
            } else {
                "Not signed in / no auth.json"
            },
            auth.is_some(),
        ));
    }

    rows
}
