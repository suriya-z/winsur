//! SSH reverse tunnels so remote agents can reach the local hook server.

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use serde_json::{json, Value};

use crate::settings::winsur_dir;

fn config_path() -> PathBuf {
    winsur_dir().join("ssh-remotes.json")
}

fn ensure_config() {
    let dir = winsur_dir();
    let _ = fs::create_dir_all(&dir);
    let path = config_path();
    if !path.exists() {
        let _ = fs::write(
            &path,
            serde_json::to_string_pretty(&json!({ "remotes": [] })).unwrap_or_else(|_| "{}".into()),
        );
    }
}

fn load_remotes() -> Vec<Value> {
    ensure_config();
    fs::read_to_string(config_path())
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.get("remotes").and_then(|r| r.as_array()).cloned())
        .unwrap_or_default()
}

fn save_remotes(remotes: &[Value]) {
    ensure_config();
    let _ = fs::write(
        config_path(),
        serde_json::to_string_pretty(&json!({ "remotes": remotes }))
            .unwrap_or_else(|_| "{}".into()),
    );
}

pub struct SshManager {
    tunnels: Mutex<HashMap<String, Child>>,
}

impl Default for SshManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SshManager {
    pub fn new() -> Self {
        Self {
            tunnels: Mutex::new(HashMap::new()),
        }
    }

    pub fn list_remotes(&self) -> Vec<Value> {
        let mut tunnels = self.tunnels.lock().expect("tunnels");
        let mut dead = Vec::new();
        for (id, child) in tunnels.iter_mut() {
            if child.try_wait().ok().flatten().is_some() {
                dead.push(id.clone());
            }
        }
        for id in dead {
            tunnels.remove(&id);
        }
        let connected: Vec<String> = tunnels.keys().cloned().collect();
        drop(tunnels);
        load_remotes()
            .into_iter()
            .map(|mut r| {
                let id = r
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                r["connected"] = json!(connected.iter().any(|c| c == &id));
                r
            })
            .collect()
    }

    pub fn connect_remote(&self, id: &str) -> Result<Value, String> {
        let remotes = load_remotes();
        let remote = remotes
            .iter()
            .find(|r| r.get("id").and_then(|v| v.as_str()) == Some(id))
            .cloned()
            .ok_or_else(|| "Remote not found".to_string())?;
        {
            let mut tunnels = self.tunnels.lock().expect("tunnels");
            if let Some(child) = tunnels.get_mut(id) {
                if child.try_wait().ok().flatten().is_none() {
                    return Ok(json!({ "ok": true, "detail": "already connected" }));
                }
            }
        }
        let host = remote
            .get("host")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if host.is_empty() {
            return Err("Remote host is empty".into());
        }
        let remote_port = remote
            .get("remotePort")
            .and_then(|v| v.as_u64())
            .unwrap_or(18900);
        let mut cmd = Command::new("ssh");
        cmd.args([
            "-N",
            "-o",
            "ServerAliveInterval=30",
            "-o",
            "ServerAliveCountMax=3",
            "-o",
            "ExitOnForwardFailure=yes",
            "-R",
            &format!("{remote_port}:127.0.0.1:18900"),
            &host,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        if let Some(stderr) = child.stderr.take() {
            let tag = id.to_string();
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    eprintln!("[ssh:{tag}] {line}");
                }
            });
        }
        self.tunnels
            .lock()
            .expect("tunnels")
            .insert(id.to_string(), child);
        Ok(
            json!({ "ok": true, "detail": format!("tunnel {host} -R {remote_port}:localhost:18900") }),
        )
    }

    pub fn disconnect_remote(&self, id: &str) -> Value {
        if let Some(mut child) = self.tunnels.lock().expect("tunnels").remove(id) {
            let _ = child.kill();
            let _ = child.wait();
        }
        json!({ "ok": true })
    }

    pub fn disconnect_all(&self) {
        let ids: Vec<String> = self
            .tunnels
            .lock()
            .expect("tunnels")
            .keys()
            .cloned()
            .collect();
        for id in ids {
            self.disconnect_remote(&id);
        }
    }

    pub fn add_remote(&self, remote: &Value) -> Vec<Value> {
        let mut remotes = load_remotes();
        let fallback = remote
            .get("name")
            .and_then(|v| v.as_str())
            .or_else(|| remote.get("host").and_then(|v| v.as_str()))
            .unwrap_or("remote");
        let id = remote
            .get("id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| slug(fallback));
        let row = json!({
            "id": id,
            "name": remote.get("name").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or(&id),
            "host": remote.get("host").and_then(|v| v.as_str()).unwrap_or(""),
            "remotePort": remote.get("remotePort").and_then(|v| v.as_u64()).unwrap_or(18900),
            "enabled": remote.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false)
        });
        if let Some(idx) = remotes
            .iter()
            .position(|r| r.get("id").and_then(|v| v.as_str()) == Some(id.as_str()))
        {
            let mut merged = remotes[idx].clone();
            if let (Some(dst), Some(src)) = (merged.as_object_mut(), row.as_object()) {
                for (k, v) in src {
                    dst.insert(k.clone(), v.clone());
                }
            }
            remotes[idx] = merged;
        } else {
            remotes.push(row);
        }
        save_remotes(&remotes);
        self.list_remotes()
    }

    pub fn remove_remote(&self, id: &str) -> Vec<Value> {
        self.disconnect_remote(id);
        let remotes: Vec<Value> = load_remotes()
            .into_iter()
            .filter(|r| r.get("id").and_then(|v| v.as_str()) != Some(id))
            .collect();
        save_remotes(&remotes);
        self.list_remotes()
    }

    pub fn deploy_script() -> &'static str {
        "#!/usr/bin/env bash\n# Run on the REMOTE machine where agents live.\n# Point agent hooks at: http://127.0.0.1:18900/hooks/event\n# Then from your Windows PC, connect this host in Winsur SSH panel\n# (reverse tunnel publishes remote :18900 to your local Winsur).\necho \"Configure agent hooks to http://127.0.0.1:18900/hooks/event\"\necho \"Keep SSH reverse tunnel connected from Winsur.\"\n"
    }
}

fn slug(input: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in input.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            dash = false;
        } else if !dash {
            out.push('-');
            dash = true;
        }
        if out.chars().count() >= 32 {
            break;
        }
    }
    out.chars().take(32).collect()
}
