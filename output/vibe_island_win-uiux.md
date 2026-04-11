# Vibe Island Win - UI/UX 设计文档

> Version: 1.0 | 更新: 2026-04-09
> 阶段: Docs | 主导专家: UI + UX

---

## 一、设计理念

### 1.1 核心原则
- **最小干扰**: 折叠时只占用极小屏幕空间，不遮挡任何内容
- **即时可操作**: 权限审批、回复等操作不超过 2 次点击
- **视觉层次清晰**: 状态一目了然，紧急事项（权限请求）最醒目
- **流畅动效**: 所有状态变化有平滑过渡，灵感来自 iOS Dynamic Island

### 1.2 设计参考
- iPhone Dynamic Island 的展开/折叠动效
- Vibe Island (macOS) 的功能布局
- Windows 11 的 Fluent Design 圆角和亚克力效果

---

## 二、设计 Token

### 2.1 颜色系统

```css
/* 深色主题（默认） */
--bg-primary: #1a1a1a;           /* 面板背景 */
--bg-secondary: #252525;          /* 卡片背景 */
--bg-hover: #2d2d2d;              /* 悬停态 */
--bg-glass: rgba(26, 26, 26, 0.85); /* 毛玻璃背景 */

--text-primary: #f0f0f0;          /* 主要文字 */
--text-secondary: #a0a0a0;        /* 次要文字 */
--text-muted: #666666;            /* 暗淡文字 */

--accent-blue: #4a9eff;           /* 主强调色 */
--accent-green: #34d058;          /* 成功/活跃 */
--accent-yellow: #f0c000;         /* 等待/警告 */
--accent-red: #f85149;            /* 错误/拒绝 */
--accent-purple: #a371f7;         /* Agent: Codex */
--accent-orange: #f78166;         /* Agent: Cursor */

/* 状态色 */
--status-idle: #666666;           /* 空闲 - 灰色 */
--status-thinking: #4a9eff;       /* 思考中 - 蓝色，带脉冲动画 */
--status-waiting: #f0c000;        /* 等待输入 - 黄色 */
--status-error: #f85149;          /* 错误 - 红色 */

/* 浅色主题 */
--bg-primary-light: #f5f5f5;
--bg-secondary-light: #ffffff;
--text-primary-light: #1a1a1a;
--text-secondary-light: #666666;
```

### 2.2 排版

```css
--font-family: "Inter", "Segoe UI", system-ui, sans-serif;
--font-mono: "JetBrains Mono", "Cascadia Code", "Consolas", monospace;

--text-xs: 11px;      /* 状态标签、时间戳 */
--text-sm: 12px;      /* 次要信息 */
--text-base: 13px;    /* 正文 */
--text-lg: 14px;      /* 卡片标题 */
--text-xl: 16px;      /* 面板标题 */

--font-weight-normal: 400;
--font-weight-medium: 500;
--font-weight-semibold: 600;
```

### 2.3 间距

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;

--radius-sm: 8px;      /* 按钮 */
--radius-md: 12px;     /* 卡片 */
--radius-lg: 16px;     /* 面板 */
--radius-pill: 999px;  /* 胶囊/折叠态 */
```

### 2.4 阴影

```css
--shadow-island: 0 4px 24px rgba(0, 0, 0, 0.4),
                 0 0 0 1px rgba(255, 255, 255, 0.06);
--shadow-card: 0 1px 3px rgba(0, 0, 0, 0.3);
--shadow-button: 0 1px 2px rgba(0, 0, 0, 0.2);
```

---

## 三、组件规格

### 3.1 折叠态（Collapsed View）

```
宽度: 280px（根据 Agent 数量动态伸缩）
高度: 36px
圆角: radius-pill (完全圆角)
背景: bg-glass + backdrop-blur(20px)
阴影: shadow-island

布局:
┌──────────────────────────────────────────┐
│ [icon] 3 Agents   [●] [●] [○]   [▼]    │
└──────────────────────────────────────────┘

- 左侧: Lucide Activity 图标 + Agent 数量
- 中间: 状态点（每个 Agent 一个，颜色表示状态）
- 右侧: 展开箭头

交互:
- 点击任意位置展开
- 悬停显示简要状态提示
- 有权限请求时自动展开 + 黄色脉冲边框
```

### 3.2 展开态（Expanded View）

```
宽度: 480px
高度: 动态（120px ~ 400px，根据内容）
圆角: radius-lg (16px)
背景: bg-glass + backdrop-blur(20px)
阴影: shadow-island

布局:
┌──────────────────────────────────────────────────┐
│  Vibe Island                              [─] [×] │
│ ─────────────────────────────────────────────────  │
│  ┌────────────────┐  ┌────────────────┐           │
│  │ [CC] Claude #1  │  │ [CC] Claude #2  │          │
│  │ ● Thinking      │  │ ○ Waiting       │          │
│  │ 12m ago         │  │ [Allow] [Deny]  │          │
│  │ [Jump]          │  │ [Jump]          │          │
│  └────────────────┘  └────────────────┘           │
│  ┌────────────────┐                               │
│  │ [CX] Codex #1   │                              │
│  │ ○ Idle           │                              │
│  │ 5m ago           │                              │
│  │ [Jump]           │                              │
│  └────────────────┘                               │
└──────────────────────────────────────────────────┘

- 标题栏: 应用名 + 最小化 + 关闭按钮
- Agent 卡片: 网格布局，每行 2 个
- 每张卡片: 图标 + 名称 + 状态 + 时间 + 操作按钮
```

### 3.3 Agent 卡片

```
宽度: 100%（响应式）
高度: auto
圆角: radius-md (12px)
背景: bg-secondary
悬停: bg-hover

状态指示:
- idle:     status-idle 灰色圆点，静止
- thinking: status-thinking 蓝色圆点，脉冲动画
- waiting:  status-waiting 黄色圆点，呼吸动画
- error:    status-error 红色圆点，闪烁

Agent 类型图标 (Lucide):
- Claude Code: Terminal 图标，accent-blue
- Codex:       Code 图标，accent-purple
- Cursor:      MousePointer 图标，accent-orange
```

### 3.4 权限审批卡片

```
触发: PermissionRequest 事件
卡片变为高亮态（黄色边框 + 展开权限详情）

┌────────────────────────────────┐
│ [CC] Claude #2                  │
│ ⚠ Permission Request            │
│ ─────────────────────────────── │
│ Tool: Bash                      │
│ Command: rm -rf node_modules    │
│                                 │
│   [Allow]         [Deny]        │
└────────────────────────────────┘

Allow 按钮: accent-green 背景，白色文字
Deny 按钮: 透明背景，accent-red 边框和文字
```

### 3.5 提问回复卡片

```
触发: Agent 提出问题等待输入

┌────────────────────────────────┐
│ [CC] Claude #1                  │
│ ❓ Waiting for input             │
│ ─────────────────────────────── │
│ "用 PostgreSQL 还是 MySQL？"     │
│                                 │
│ ┌─────────────────────────┐    │
│ │ 输入回复...         [发送]│    │
│ └─────────────────────────┘    │
└────────────────────────────────┘
```

---

## 四、动画规格

### 4.1 折叠/展开过渡

```typescript
// Motion spring 配置
const islandSpring = {
  type: "spring",
  stiffness: 400,
  damping: 30,
  mass: 1,
};

// 折叠 → 展开
{
  width: [280, 480],
  height: [36, "auto"],
  borderRadius: ["999px", "16px"],
  transition: islandSpring
}

// 展开 → 折叠 (略快)
{
  width: [480, 280],
  height: ["auto", 36],
  borderRadius: ["16px", "999px"],
  transition: { ...islandSpring, stiffness: 500 }
}
```

### 4.2 Agent 卡片进入

```typescript
// 使用 Motion 的 layout 动画
<motion.div layout layoutId={`agent-${session.id}`}>
  <AgentCard />
</motion.div>

// 新 Agent 卡片进入
{
  initial: { opacity: 0, scale: 0.8, y: -10 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.8, y: 10 },
  transition: { duration: 0.3, ease: "easeOut" }
}
```

### 4.3 状态脉冲动画

```css
/* thinking 状态 - 蓝色脉冲 */
@keyframes pulse-thinking {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.3); }
}

/* waiting 状态 - 黄色呼吸 */
@keyframes breathe-waiting {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

/* error 状态 - 红色闪烁 */
@keyframes blink-error {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* 权限请求 - 面板边框高亮 */
@keyframes glow-permission {
  0%, 100% { box-shadow: 0 0 0 2px var(--accent-yellow); }
  50% { box-shadow: 0 0 12px 2px var(--accent-yellow); }
}
```

### 4.4 权限审批按钮动画

```typescript
// Allow 按钮按下效果
whileTap={{ scale: 0.95 }}
whileHover={{ scale: 1.03, backgroundColor: "var(--accent-green)" }}

// Deny 按钮
whileTap={{ scale: 0.95 }}
whileHover={{ borderColor: "var(--accent-red)", color: "var(--accent-red)" }}

// 审批完成后卡片收缩
{
  animate: { height: 0, opacity: 0, marginTop: 0 },
  transition: { duration: 0.3, ease: "easeInOut" }
}
```

---

## 五、交互流程

### 5.1 首次启动流程

```
1. 安装完成，启动应用
2. 显示欢迎引导（检测到 X 个 AI Agent）
3. 一键配置 Hooks → 成功提示
4. 面板出现在屏幕顶部中央
5. 等待 Agent 事件
```

### 5.2 日常使用流程

```
1. 面板折叠态显示在屏幕顶部
2. Agent 发送事件 → 状态点更新
3. 有权限请求 → 面板自动展开 + 音效提醒
4. 用户 Allow/Deny → 面板自动折叠（无其他等待项时）
5. 用户主动点击展开 → 查看所有 Agent 状态
6. 点击 Jump → 切换到对应终端
```

### 5.3 错误处理

```
- HTTP 服务器启动失败 → 系统通知 + 设置面板提示修改端口
- Agent 断开连接 → 卡片变灰 + 状态显示 "Disconnected"
- 终端窗口找不到 → Toast 提示 "终端窗口已关闭"
```

---

## 六、音效设计

| 事件 | 音效风格 | 时长 |
|------|----------|------|
| 权限请求 | 上升短促 beep (方波) | 200ms |
| 审批通过 | 清脆确认音 (三角波) | 150ms |
| 审批拒绝 | 低沉否定音 (锯齿波) | 200ms |
| Agent 完成 | 欢快完成音 (复合) | 300ms |
| Agent 错误 | 警告音 (方波低频) | 250ms |
| 新会话 | 接入音 (上行琶音) | 400ms |

所有音效为 8-bit 合成器风格，预制 WAV 文件，44100Hz/16bit/mono。

---

## 七、响应式适配

| 屏幕宽度 | 折叠态宽度 | 展开态宽度 | Agent 卡片列数 |
|----------|-----------|-----------|---------------|
| < 1280px | 240px | 380px | 1 |
| 1280-1920px | 280px | 480px | 2 |
| > 1920px | 320px | 560px | 2-3 |

---

## 八、无障碍

- 所有操作支持键盘导航（Tab/Enter/Escape）
- 颜色对比度符合 WCAG 2.1 AA 标准
- 屏幕阅读器友好的 ARIA 标签
- 尊重系统 "减少动画" 设置（useReducedMotion）
- 高对比度模式支持
