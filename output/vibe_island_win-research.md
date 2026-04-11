# Vibe Island Win - 综合研究报告

> Generated: 2026-04-09
> 阶段: Research | 主导专家: PM + ARCHITECT

## 一、项目定位

**Vibe Island Win** 是一个 Windows 平台的 AI 编程代理实时监控面板，以屏幕顶部浮动窗口（类似 iPhone 灵动岛）的形式呈现。用户无需切换窗口即可监控多个 AI Agent 状态、审批权限、回复提问、跳转终端。

---

## 二、竞品分析

### 2.1 直接竞品

| 产品 | 技术栈 | 平台 | Agent 数 | 核心差异 |
|------|--------|------|----------|----------|
| **Vibe Island** (商业) | Swift/SwiftUI | macOS only | 10 | 刘海面板，$19.99 |
| **Open Vibe Island** (开源) | Swift/SwiftUI | macOS only | 8 | GPL v3，免费 |
| **OpenCovibe** | Tauri v2 + Svelte | 跨平台(macOS优先) | 1 (Claude Code) | GUI 客户端，非覆盖层 |
| **Claude HUD** | TypeScript | 跨平台 | 1 | 终端 statusline |
| **Claude Code Monitor** | TypeScript | macOS only | 多会话 | Web UI + 手机端 |
| **Agentic Metric** | Python TUI | Linux/macOS | 5 | Token/成本监控 |

### 2.2 核心市场空白

**Windows 平台上没有任何成熟的 AI 编程代理监控 GUI 工具。** 所有成熟方案（Vibe Island, Claude Code Monitor）都是 macOS 专属，或者是纯终端界面（Claude HUD, Agentic Metric）。

### 2.3 OpenCovibe 深度分析（最接近竞品）

- Tauri v2 + Svelte 5，v0.1.50，Stars 106
- 本质上是 Claude Code 的 GUI 客户端（三栏布局），**不是** 覆盖层/浮动面板
- 仅支持 Claude Code 一个 Agent，Codex 在开发中
- macOS 优先，Windows 支持薄弱
- 单人项目（93.7% commits 来自一人），bug 较多
- **我们的差异化**: 覆盖层形态（灵动岛） + Windows 优先 + 真正多 Agent + 更高质量

### 2.4 Vibe Island 核心功能（我们要实现的）

| 功能 | 说明 | 优先级 |
|------|------|--------|
| Monitor | 实时监控多个 Agent 会话状态 | P0 |
| Approve/Deny | GUI 权限审批 | P0 |
| Ask/Reply | 回复 Agent 提问 | P0 |
| Jump | 跳转到对应终端标签页 | P0 |
| Sound Alert | 8-bit 音效提醒 | P1 |
| Plan Review | Markdown 计划审查 | P1 |
| Zero Config | 自动配置所有 Agent hooks | P1 |
| System Tray | 托盘集成 | P1 |

---

## 三、技术方案研究

### 3.1 技术栈选定: Tauri v2 + React + Rust

| 组件 | 选型 | 理由 |
|------|------|------|
| 桌面框架 | Tauri v2 | 内存 10-30MB（vs Electron 200MB+），包体积 2-5MB |
| 前端 | React 19 + Vite | 生态最大，动画库丰富 |
| 动画 | Motion (原 Framer Motion) | 弹性动画，`layout` 动画，GPU 加速 |
| 图标 | Lucide React | 轻量，图标丰富 |
| 样式 | Tailwind CSS | 快速开发 |
| 状态管理 | Zustand | 轻量，适合中小型应用 |
| Rust HTTP | axum | 与 Tauri 共享 tokio 运行时 |
| 音频 | Rodio (Rust) | 原生播放，无需用户交互触发 |
| 数据库 | SQLite (rusqlite) | 会话历史持久化 |
| Win32 API | windows crate | 窗口管理，终端焦点切换 |

### 3.2 透明窗口方案

**Tauri 配置**:
```json
{
  "transparent": true,
  "decorations": false,
  "alwaysOnTop": true,
  "shadow": false,
  "skipTaskbar": true
}
```

**已知问题与解决**:
- `shadow: false` 必须显式设置（v2 默认开启 shadow 会导致透明失效）
- CSS 必须 `html, body { background: transparent !important; }`
- Windows 10 白色闪烁：窗口初始化时可能出现，需延迟显示

**点击穿透方案**: Rust 端 60fps 轮询光标位置 + `setIgnoreCursorEvents` 动态切换

### 3.3 AI Agent 接入机制

**Claude Code (HTTP Hook - 核心通道)**:
```json
// ~/.claude/settings.json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "", "hooks": [
      { "type": "http", "url": "http://localhost:18900/hooks/event" }
    ]}],
    "PostToolUse": [...],
    "Notification": [...],
    "Stop": [...],
    "SessionStart": [...],
    "PermissionRequest": [...]
  }
}
```

支持 21+ 个生命周期事件。HTTP Hook 的特点：
- 失败时非阻塞（不影响 Agent 正常工作）
- 默认超时 30 秒
- 可通过返回 `permissionDecision` 控制权限

**Codex CLI**: 支持 hooks.json（格式类似 Claude Code），但 **Windows 上当前被禁用**。可通过 `--json` 标志获取事件流。

**Cursor**: 支持 `~/.cursor/hooks.json`，格式与 Claude Code 类似。

### 3.4 终端焦点切换

使用 `windows` crate 调用 Win32 API:
- `EnumWindows` 枚举所有窗口
- `GetWindowText` 匹配终端标题
- `SetForegroundWindow` + `ShowWindow` 切换焦点
- Windows Terminal (UWP) 需特殊处理：`wt -w <id> focus-tab -t <index>`

**SetForegroundWindow 限制**: Windows 限制非前台进程调用此 API，需要通过 `AttachThreadInput` + `AllowSetForegroundWindow` 绕过。

### 3.5 音效方案

- Rust 后端: Rodio 播放预制 WAV 文件（8-bit 风格）
- 前端可选: Tone.js 实时合成（需用户交互触发）
- 支持自定义音效包（用户可替换 WAV 文件）

---

## 四、Windows Dynamic Island 开源参考项目

| 项目 | 技术栈 | 参考价值 |
|------|--------|----------|
| **dynamic-island-on-windows** | C# WPF + WinRT | 三层架构最清晰，iOS 风格动画 |
| **dynamic-island-desktop** | Electron + Python | GSAP 弹性动画，WebSocket 实时通信 |
| **WinIsland** | Rust + Win32 + Skia | 极致性能参考 |
| **DynamicWin** | C# FenUI | 功能丰富（媒体、日历、蓝牙） |

---

## 五、差异化策略

### 我们 vs 竞品的核心优势

1. **Windows 优先** — 所有竞品都是 macOS 优先或专属
2. **覆盖层形态** — 浮动面板，不是传统窗口应用（vs OpenCovibe 的三栏布局）
3. **真正多 Agent** — 支持 Claude Code + Codex + Cursor + 可扩展（vs OpenCovibe 仅 Claude Code）
4. **极低资源占用** — Tauri 10-30MB（vs Electron 200MB+）
5. **零配置自动 Hook** — 安装后自动配置所有 Agent 的 hooks

### 禁用项（研究中排除的方案）

- Electron（内存占用不可接受）
- macOS 专属 API（SwiftUI, AppKit, AppleScript）
- Emoji 作为图标（Super Dev 约束）
- 紫/粉渐变主色调（AI 模板化禁令）

---

## 六、技术可行性总结

| 需求 | 可行性 | 风险等级 |
|------|--------|----------|
| 透明无边框置顶窗口 | 可行 | 中（shadow=false, 白色闪烁） |
| 透明区域点击穿透 | 可行（workaround） | 中（需 Rust 光标轮询） |
| 系统托盘 | 完全可行 | 低 |
| 内嵌 HTTP 服务器 | 完全可行 | 低（axum 共享 tokio） |
| Claude Code Hook 接收 | 完全可行 | 低 |
| Motion 动画 | 可行 | 低（WebView2 GPU 加速） |
| 终端焦点切换 | 可行 | 中（SetForegroundWindow 限制） |
| Windows 10 兼容 | 可行 | 中（需捆绑 WebView2） |
| 音效播放 | 完全可行 | 低（Rodio） |
