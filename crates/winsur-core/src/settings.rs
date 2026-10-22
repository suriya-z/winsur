//! `~/.winsur/settings.json`

use std::fs;
use std::path::PathBuf;

use serde_json::{json, Value};

pub fn winsur_dir() -> PathBuf {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_default();
    home.join(".winsur")
}

pub fn settings_path() -> PathBuf {
    winsur_dir().join("settings.json")
}

pub fn defaults() -> Value {
    json!({
        "httpPort": 18900,
        "soundEnabled": true,
        "soundVolume": 80,
        "autoStart": false,
        "theme": "dark"
    })
}

pub fn get_settings() -> Value {
    let mut merged = defaults();
    if let Ok(text) = fs::read_to_string(settings_path()) {
        if let Ok(Value::Object(saved)) = serde_json::from_str::<Value>(&text) {
            if let Some(obj) = merged.as_object_mut() {
                for (k, v) in saved {
                    obj.insert(k, v);
                }
            }
        }
    }
    merged
}

pub fn save_settings(patch: &Value) -> std::io::Result<Value> {
    let dir = winsur_dir();
    fs::create_dir_all(&dir)?;
    let path = dir.join("settings.json");
    let mut cur = if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_else(|| json!({}))
    } else {
        json!({})
    };
    if let (Some(dst), Some(src)) = (cur.as_object_mut(), patch.as_object()) {
        for (k, v) in src {
            dst.insert(k.clone(), v.clone());
        }
    }
    fs::write(
        &path,
        serde_json::to_string_pretty(&cur).unwrap_or_else(|_| "{}".into()),
    )?;
    Ok(cur)
}
