// Hook 安装器模块
// 功能：自动配置 Claude Code / Codex CLI / Claude Desktop / Antigravity 等 Agent 的 hooks
// 指向 Vibe Island 的 HTTP 服务器

use serde_json::{json, Value};
use std::path::PathBuf;

/// 支持的 Agent 宿主信息
struct AgentHost {
    name: &'static str,
    config_path: Option<PathBuf>,
    hooks_key: &'static str,
}

/// 获取所有支持的 Agent 宿主配置路径
fn get_agent_hosts() -> Vec<AgentHost> {
    let home = std::env::var("USERPROFILE").unwrap_or_default();
    let appdata = std::env::var("APPDATA").unwrap_or_default();

    vec![
        // Claude Code CLI: ~/.claude/settings.json
        AgentHost {
            name: "Claude Code",
            config_path: if !home.is_empty() {
                Some(PathBuf::from(&home).join(".claude").join("settings.json"))
            } else { None },
            hooks_key: "hooks",
        },
        // Codex CLI: ~/.codex/config.json
        AgentHost {
            name: "Codex CLI",
            config_path: if !home.is_empty() {
                Some(PathBuf::from(&home).join(".codex").join("config.json"))
            } else { None },
            hooks_key: "hooks",
        },
        // Claude Desktop App: %APPDATA%/Claude/settings.json
        AgentHost {
            name: "Claude Desktop",
            config_path: if !appdata.is_empty() {
                Some(PathBuf::from(&appdata).join("Claude").join("settings.json"))
            } else { None },
            hooks_key: "hooks",
        },
        // Antigravity: %APPDATA%/antigravity/config.json
        AgentHost {
            name: "Antigravity",
            config_path: if !appdata.is_empty() {
                Some(PathBuf::from(&appdata).join("antigravity").join("config.json"))
            } else { None },
            hooks_key: "hooks",
        },
        // OpenCode: ~/.opencode/config.json
        AgentHost {
            name: "OpenCode",
            config_path: if !home.is_empty() {
                Some(PathBuf::from(&home).join(".opencode").join("config.json"))
            } else { None },
            hooks_key: "hooks",
        },
        // Qwen Code: ~/.qwen-code/config.json
        AgentHost {
            name: "Qwen Code",
            config_path: if !home.is_empty() {
                Some(PathBuf::from(&home).join(".qwen-code").join("config.json"))
            } else { None },
            hooks_key: "hooks",
        },
        // CodeBuddy: ~/.codebuddy/config.json
        AgentHost {
            name: "CodeBuddy",
            config_path: if !home.is_empty() {
                Some(PathBuf::from(&home).join(".codebuddy").join("config.json"))
            } else { None },
            hooks_key: "hooks",
        },
        // Windsurf / Codeium: %APPDATA%/Windsurf/config.json
        AgentHost {
            name: "Windsurf",
            config_path: if !appdata.is_empty() {
                Some(PathBuf::from(&appdata).join("Windsurf").join("config.json"))
            } else { None },
            hooks_key: "hooks",
        },
    ]
}

/// 获取 hook 脚本的绝对路径
fn get_hook_script_path() -> Option<String> {
    // 首先检查 exe 同目录下的 hooks 文件夹
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let script = exe_dir.join("hooks").join("vibe-island-hook.ps1");
            if script.exists() {
                return Some(script.to_string_lossy().to_string());
            }
        }
    }

    // 回退：检查常见的开发目录
    let dev_paths = [
        "E:\\vibe_island_win\\hooks\\vibe-island-hook.ps1",
        "C:\\vibe_island_win\\hooks\\vibe-island-hook.ps1",
    ];

    for p in &dev_paths {
        if std::path::Path::new(p).exists() {
            return Some(p.to_string());
        }
    }

    // 尝试从 USERPROFILE 下找
    if let Ok(home) = std::env::var("USERPROFILE") {
        let p = PathBuf::from(&home)
            .join(".vibe-island")
            .join("hooks")
            .join("vibe-island-hook.ps1");
        if p.exists() {
            return Some(p.to_string_lossy().to_string());
        }
    }

    None
}

/// 生成 hook 命令字符串
fn hook_command(hook_script_path: &str, event_name: &str) -> String {
    format!(
        "powershell -ExecutionPolicy Bypass -NoProfile -File \"{}\" {}",
        hook_script_path,
        event_name
    )
}

/// 为指定的配置文件安装 hooks
fn install_hooks_to_config(config_path: &PathBuf, hook_script: &str, hooks_key: &str) -> Result<(), String> {
    // 读取现有配置或创建新配置
    let mut settings: Value = if config_path.exists() {
        let content = std::fs::read_to_string(config_path)
            .map_err(|e| format!("读取配置失败: {}", e))?;
        serde_json::from_str(&content).unwrap_or_else(|_| json!({}))
    } else {
        // 确保目录存在
        if let Some(parent) = config_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建配置目录失败: {}", e))?;
        }
        json!({})
    };

    // 构建 hooks 配置
    let hooks = json!({
        "PreToolUse": [{
            "type": "command",
            "command": hook_command(hook_script, "PreToolUse")
        }],
        "PostToolUse": [{
            "type": "command",
            "command": hook_command(hook_script, "PostToolUse")
        }],
        "Notification": [{
            "type": "command",
            "command": hook_command(hook_script, "Notification")
        }]
    });

    let settings_obj = settings.as_object_mut()
        .ok_or("配置文件格式错误")?;

    // 合并 hooks（不覆盖用户已有的其他 hooks）
    if let Some(existing_hooks) = settings_obj.get_mut(hooks_key) {
        if let Some(existing_map) = existing_hooks.as_object_mut() {
            for (event_name, hook_entries) in hooks.as_object().unwrap() {
                if let Some(existing_entries) = existing_map.get_mut(event_name) {
                    if let Some(arr) = existing_entries.as_array_mut() {
                        // 移除旧的 Vibe Island hook
                        arr.retain(|entry| {
                            if let Some(cmd) = entry.get("command").and_then(|c| c.as_str()) {
                                !cmd.contains("vibe-island-hook")
                            } else {
                                true
                            }
                        });
                        // 添加新的
                        if let Some(new_entries) = hook_entries.as_array() {
                            arr.extend(new_entries.iter().cloned());
                        }
                    }
                } else {
                    existing_map.insert(event_name.clone(), hook_entries.clone());
                }
            }
        }
    } else {
        settings_obj.insert(hooks_key.to_string(), hooks);
    }

    // 写回配置文件
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("序列化配置失败: {}", e))?;
    std::fs::write(config_path, content)
        .map_err(|e| format!("写入配置失败: {}", e))?;

    Ok(())
}

/// 从指定的配置文件卸载 hooks
fn uninstall_hooks_from_config(config_path: &PathBuf, hooks_key: &str) -> Result<(), String> {
    if !config_path.exists() {
        return Ok(());
    }

    let content = std::fs::read_to_string(config_path)
        .map_err(|e| format!("读取配置失败: {}", e))?;

    let mut settings: Value = serde_json::from_str(&content)
        .map_err(|e| format!("解析配置失败: {}", e))?;

    if let Some(hooks) = settings.get_mut(hooks_key).and_then(|h| h.as_object_mut()) {
        for (_event, entries) in hooks.iter_mut() {
            if let Some(arr) = entries.as_array_mut() {
                arr.retain(|entry| {
                    if let Some(cmd) = entry.get("command").and_then(|c| c.as_str()) {
                        !cmd.contains("vibe-island-hook")
                    } else {
                        true
                    }
                });
            }
        }
    }

    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(config_path, content)
        .map_err(|e| format!("写入失败: {}", e))?;

    Ok(())
}

/// 安装所有已检测到的 Agent 的 hooks
///
/// 扫描所有支持的 Agent 配置目录，只要配置文件存在或目录存在就安装
pub fn install_all_hooks() -> Result<String, String> {
    let hook_script = get_hook_script_path()
        .ok_or("无法找到 hook 脚本文件。请确保 hooks/vibe-island-hook.ps1 存在。")?;

    let hosts = get_agent_hosts();
    let mut installed = Vec::new();
    let mut skipped = Vec::new();
    let mut errors = Vec::new();

    for host in &hosts {
        if let Some(config_path) = &host.config_path {
            // 检查配置文件是否存在，或者其父目录是否存在（说明该 Agent 已安装）
            let parent_exists = config_path.parent().map(|p| p.exists()).unwrap_or(false);
            let config_exists = config_path.exists();

            if config_exists || parent_exists {
                match install_hooks_to_config(config_path, &hook_script, host.hooks_key) {
                    Ok(()) => installed.push(host.name),
                    Err(e) => errors.push(format!("{}: {}", host.name, e)),
                }
            } else {
                skipped.push(host.name);
            }
        }
    }

    let mut msg = String::new();
    if !installed.is_empty() {
        msg.push_str(&format!("已安装: {}", installed.join(", ")));
    }
    if !skipped.is_empty() {
        if !msg.is_empty() { msg.push_str("\n"); }
        msg.push_str(&format!("未检测到: {}", skipped.join(", ")));
    }
    if !errors.is_empty() {
        if !msg.is_empty() { msg.push_str("\n"); }
        msg.push_str(&format!("安装失败: {}", errors.join("; ")));
    }

    if installed.is_empty() && !errors.is_empty() {
        Err(msg)
    } else {
        Ok(msg)
    }
}

/// 卸载所有 Agent 的 hooks
pub fn uninstall_all_hooks() -> Result<String, String> {
    let hosts = get_agent_hosts();
    let mut uninstalled = Vec::new();
    let mut errors = Vec::new();

    for host in &hosts {
        if let Some(config_path) = &host.config_path {
            if config_path.exists() {
                match uninstall_hooks_from_config(config_path, host.hooks_key) {
                    Ok(()) => uninstalled.push(host.name),
                    Err(e) => errors.push(format!("{}: {}", host.name, e)),
                }
            }
        }
    }

    let mut msg = String::new();
    if !uninstalled.is_empty() {
        msg.push_str(&format!("已卸载: {}", uninstalled.join(", ")));
    }
    if !errors.is_empty() {
        if !msg.is_empty() { msg.push_str("\n"); }
        msg.push_str(&format!("卸载失败: {}", errors.join("; ")));
    }
    if msg.is_empty() {
        msg = "没有需要卸载的 hooks".to_string();
    }

    Ok(msg)
}

/// 检查所有 Agent 的 hooks 安装状态
pub fn check_hooks_status() -> Value {
    let hosts = get_agent_hosts();
    let mut status = json!({});

    for host in &hosts {
        let key = host.name.to_lowercase().replace(' ', "_");
        let mut host_status = json!({
            "installed": false,
            "detected": false,
            "path": null,
        });

        if let Some(config_path) = &host.config_path {
            host_status["path"] = json!(config_path.to_string_lossy());

            // 检查 Agent 是否已安装（配置目录存在）
            let parent_exists = config_path.parent().map(|p| p.exists()).unwrap_or(false);
            host_status["detected"] = json!(parent_exists || config_path.exists());

            // 检查 hooks 是否已安装
            if config_path.exists() {
                if let Ok(content) = std::fs::read_to_string(config_path) {
                    if content.contains("vibe-island-hook") {
                        host_status["installed"] = json!(true);
                    }
                }
            }
        }

        status[key] = host_status;
    }

    // hook 脚本路径
    status["hook_script"] = json!(get_hook_script_path());

    status
}
