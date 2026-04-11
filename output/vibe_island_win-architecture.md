# Vibe Island Win - 架构设计文档

> Version: 1.0 | 更新: 2026-04-09
> 阶段: Docs | 主导专家: ARCHITECT

---

## 一、系统架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                    屏幕顶部浮动面板                            │
│  React 19 + Motion + Tailwind CSS + Lucide React            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  折叠态: [icon] 3 Agents Active  [●●○]              │   │
│  │  展开态:                                              │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐                │   │
│  │  │CC #1    │ │CC #2    │ │Codex    │                 │   │
│  │  │thinking │ │waiting  │ │idle     │                 │   │
│  │  │[Jump]   │ │[Allow]  │ │[Jump]   │                 │   │
│  │  └─────────┘ └─────────┘ └─────────┘                │   │
│  └──────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │ Tauri IPC (invoke/emit)
┌───────────────────────────┴─────────────────────────────────┐
│                      Rust 后端 (Tauri)                       │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Hook Server  │  │ Session Mgr  │  │ Window Manager    │  │
│  │ (axum)       │  │ (状态聚合)    │  │ (Win32 API)       │  │
│  │ :18900       │  │              │  │ SetForegroundWin  │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────────┘  │
│         │                 │                   │              │
│  ┌──────┴───────┐  ┌──────┴───────┐  ┌───────┴───────────┐  │
│  │ Audio Engine │  │ Config Mgr   │  │ Auto Setup        │  │
│  │ (rodio)      │  │ (SQLite)     │  │ (Hook 自动配置)    │  │
│  └──────────────┘  └──────────────┘  └───────────────────┘  │
└──────────────────────────────────────────────────────────────┘
         ▲                    ▲                    ▲
    HTTP POST            读/写配置           枚举窗口
         │                    │                    │
┌────────┴────┐  ┌────────────┴──────┐  ┌──────────┴──────┐
│ Claude Code │  │ ~/.claude/        │  │ Windows Terminal │
│ Codex CLI   │  │ ~/.codex/         │  │ VS Code          │
│ Cursor      │  │ ~/.cursor/        │  │ PowerShell       │
└─────────────┘  └───────────────────┘  └─────────────────┘
```

---

## 二、模块设计

### 2.1 前端模块 (src/)

```
src/
├── App.tsx                  # 应用入口
├── main.tsx                 # Vite 入口
├── styles/
│   └── globals.css          # 全局样式 + Tailwind
├── components/
│   ├── Island/
│   │   ├── IslandContainer.tsx    # 灵动岛主容器，管理折叠/展开
│   │   ├── CollapsedView.tsx      # 折叠态视图（胶囊）
│   │   ├── ExpandedView.tsx       # 展开态视图（完整面板）
│   │   └── IslandAnimator.tsx     # 动画控制器
│   ├── Agent/
│   │   ├── AgentCard.tsx          # 单个 Agent 卡片
│   │   ├── AgentStatus.tsx        # 状态指示器
│   │   ├── PermissionPrompt.tsx   # 权限审批 UI
│   │   └── QuestionReply.tsx      # 提问回复 UI
│   ├── Settings/
│   │   └── SettingsPanel.tsx      # 设置面板
│   └── shared/
│       ├── StatusDot.tsx          # 状态点
│       └── ActionButton.tsx       # 操作按钮
├── stores/
│   ├── agentStore.ts        # Agent 状态 (Zustand)
│   ├── settingsStore.ts     # 设置状态
│   └── uiStore.ts           # UI 状态（展开/折叠等）
├── hooks/
│   ├── useAgentEvents.ts    # 监听 Agent 事件
│   ├── useIslandPosition.ts # 面板位置管理
│   └── useSoundEffect.ts    # 音效 hook
├── lib/
│   ├── tauri.ts             # Tauri IPC 封装
│   └── constants.ts         # 常量定义
└── types/
    └── agent.ts             # TypeScript 类型定义
```

### 2.2 Rust 后端模块 (src-tauri/src/)

```
src-tauri/src/
├── main.rs                  # Tauri 应用入口
├── lib.rs                   # 模块导出
├── commands/
│   ├── mod.rs               # Tauri 命令路由
│   ├── agent.rs             # Agent 管理命令
│   ├── window.rs            # 窗口控制命令
│   ├── settings.rs          # 设置管理命令
│   └── permission.rs        # 权限响应命令
├── server/
│   ├── mod.rs               # HTTP 服务器入口
│   ├── routes.rs            # 路由定义
│   └── handlers.rs          # 请求处理器
├── agent/
│   ├── mod.rs               # Agent 管理器
│   ├── session.rs           # 会话状态
│   ├── types.rs             # Agent 类型定义
│   └── detector.rs          # Agent 自动检测
├── window/
│   ├── mod.rs               # 窗口管理
│   ├── overlay.rs           # 覆盖窗口控制
│   ├── cursor.rs            # 光标位置追踪
│   └── focus.rs             # 终端焦点切换
├── audio/
│   ├── mod.rs               # 音频引擎
│   └── sounds.rs            # 音效资源管理
├── setup/
│   ├── mod.rs               # 自动配置
│   ├── claude_code.rs       # Claude Code Hook 配置
│   ├── codex.rs             # Codex 配置
│   └── cursor.rs            # Cursor 配置
├── storage/
│   ├── mod.rs               # 存储层
│   ├── database.rs          # SQLite 操作
│   └── config.rs            # 配置文件管理
└── platform/
    └── windows.rs           # Windows 平台特定代码
```

---

## 三、核心数据流

### 3.1 Agent 事件接收流

```
Claude Code (Hook 触发)
  │ HTTP POST http://localhost:18900/hooks/event
  ▼
axum Handler (server/handlers.rs)
  │ 1. 解析 JSON payload
  │ 2. 提取 session_id, hook_event_name, tool_name 等
  │ 3. 更新 AgentSession 状态
  ▼
Session Manager (agent/session.rs)
  │ 4. 更新内存中的会话状态
  │ 5. 写入 SQLite (可选，用于历史)
  ▼
Tauri Event Emit
  │ 6. app_handle.emit("agent-event", &event_data)
  ▼
React Frontend (hooks/useAgentEvents.ts)
  │ 7. listen("agent-event", callback)
  │ 8. 更新 Zustand store
  ▼
UI 重渲染（带 Motion 动画过渡）
```

### 3.2 权限审批流

```
Agent 请求权限 → HTTP POST (PermissionRequest 事件)
  ▼
面板自动展开，显示权限详情
  ▼
用户点击 Allow/Deny
  ▼
前端调用 Tauri invoke("respond_permission", {session_id, decision})
  ▼
Rust 后端构造 HTTP 响应:
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow" | "deny"
  },
  "continue": true
}
  ▼
返回给 Claude Code（挂起的 HTTP 请求）
```

### 3.3 终端跳转流

```
用户点击 Agent 卡片的 "Jump" 按钮
  ▼
前端调用 Tauri invoke("focus_terminal", {session_id})
  ▼
Rust 后端:
  1. 从 SessionManager 获取该会话对应的终端窗口信息
  2. EnumWindows 查找匹配的窗口句柄
  3. ShowWindow(hwnd, SW_RESTORE) 恢复窗口
  4. SetForegroundWindow(hwnd) 切换焦点
  ▼
目标终端获得焦点
```

---

## 四、API 定义

### 4.1 HTTP API（Agent → 我们）

**POST /hooks/event**
接收所有 Agent Hook 事件的统一端点。

请求体（由 Agent 发送）:
```json
{
  "session_id": "string",
  "hook_event_name": "PreToolUse | PostToolUse | PermissionRequest | Notification | Stop | SessionStart | SessionEnd",
  "cwd": "string",
  "transcript_path": "string",
  "tool_name": "string?",
  "tool_input": "object?",
  "tool_response": "object?",
  "message": "string?",
  "permission_mode": "string?"
}
```

响应体（我们返回给 Agent）:

简单确认:
```json
{}
```

权限控制（仅 PreToolUse）:
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow | deny | ask | defer",
    "additionalContext": "string?"
  },
  "continue": true
}
```

### 4.2 Tauri IPC 命令

```typescript
// 前端 → Rust 命令
invoke("get_agents") → Agent[]                    // 获取所有 Agent 列表
invoke("respond_permission", {sessionId, decision}) → void  // 响应权限
invoke("focus_terminal", {sessionId}) → void       // 跳转终端
invoke("reply_question", {sessionId, message}) → void  // 回复提问
invoke("get_settings") → Settings                 // 获取设置
invoke("update_settings", {settings}) → void       // 更新设置
invoke("setup_hooks") → SetupResult               // 自动配置 hooks
invoke("play_sound", {soundType}) → void           // 播放音效

// Rust → 前端 事件
emit("agent-event", AgentEvent)                    // Agent 状态变化
emit("permission-request", PermissionRequest)      // 权限请求
emit("agent-question", AgentQuestion)              // Agent 提问
emit("agent-error", AgentError)                    // Agent 错误
```

### 4.3 数据模型

```typescript
// Agent 会话
interface AgentSession {
  id: string;                    // 会话 ID
  agentType: "claude-code" | "codex" | "cursor";
  status: "idle" | "thinking" | "waiting" | "error";
  name: string;                  // 会话名称/项目目录
  cwd: string;                   // 工作目录
  startedAt: number;             // 开始时间戳
  lastEventAt: number;           // 最后事件时间戳
  terminalWindow?: WindowInfo;   // 关联的终端窗口
}

// 权限请求
interface PermissionRequest {
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  description: string;
  timestamp: number;
}

// 窗口信息
interface WindowInfo {
  hwnd: number;
  title: string;
  processName: string;
  className: string;
}

// 设置
interface Settings {
  httpPort: number;              // HTTP 服务端口，默认 18900
  soundEnabled: boolean;         // 音效开关
  soundVolume: number;           // 音量 0-100
  autoStart: boolean;            // 开机自启
  theme: "dark" | "light";       // 主题
  position: { x: number; y: number }; // 面板位置
  enabledAgents: string[];       // 启用的 Agent 类型
}
```

---

## 五、技术选型详情

| 依赖 | 版本 | 用途 |
|------|------|------|
| **tauri** | 2.x | 桌面应用框架 |
| **axum** | 0.8.x | HTTP 服务器 |
| **tokio** | 1.x | 异步运行时（Tauri 内置） |
| **serde** | 1.x | 序列化/反序列化 |
| **rusqlite** | 0.32.x | SQLite 绑定 |
| **rodio** | 0.19.x | 音频播放 |
| **windows** | 0.58.x | Win32 API 绑定 |
| **react** | 19.x | 前端框架 |
| **motion** | 12.x | 动画 |
| **zustand** | 5.x | 状态管理 |
| **tailwindcss** | 4.x | CSS 框架 |
| **lucide-react** | 0.460.x | 图标库 |
| **@tauri-apps/api** | 2.x | Tauri 前端 API |

---

## 六、部署架构

```
安装包 (NSIS Installer, ~10MB)
  ├── vibe-island-win.exe     # Tauri 应用
  ├── WebView2 Bootstrapper   # 自动安装 WebView2 (如未安装)
  ├── resources/
  │   ├── sounds/             # 音效文件
  │   └── icons/              # 应用图标
  └── 安装脚本
      ├── 注册开机自启动 (可选)
      ├── 创建开始菜单快捷方式
      └── 创建桌面快捷方式 (可选)
```

数据存储位置: `%APPDATA%/vibe-island-win/`
- `config.json` — 用户设置
- `sessions.db` — SQLite 会话历史
- `sounds/` — 自定义音效
- `logs/` — 应用日志

---

## 七、安全考虑

1. **HTTP 服务器仅监听 localhost** — 绑定 `127.0.0.1:18900`，不暴露到网络
2. **无数据上传** — 所有数据本地存储
3. **Hook 配置权限** — 修改 Agent 配置文件前提示用户确认
4. **进程隔离** — Tauri 的 Rust 后端与 WebView 进程分离
5. **输入验证** — 所有 HTTP 请求都进行 JSON schema 验证
