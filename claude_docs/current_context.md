# 当前上下文

- **当前任务**: v0.2.0 迭代中 - 编译修复 + Agent 扩展 + 窗口优化完成
- **项目状态**: 10 种 Agent 类型支持，全量构建通过
- **技术栈**: Tauri v2 + React 19 + Rust + axum + Motion + Tailwind CSS
- **HTTP Hook 端口**: 18900

## 已完成功能（对标 vibeisland.app）
| 功能 | 状态 | 说明 |
|------|------|------|
| F1 灵动岛浮动面板 | 完成 | 折叠/展开 + 弹簧动画 + 拖拽 |
| F2 Agent 会话监控 | 完成 | 6 状态 + 8 种 Agent 类型 |
| F3 权限审批 | 完成 | 阻塞式 HTTP + Allow/Deny + Enter/Esc |
| F4 提问回复 | 完成 | QuestionReply UI + SendInput 注入 |
| F5 终端跳转 | 完成 | 多级评分匹配 + 回退机制 |
| F6 系统托盘 | 完成 | 显隐切换 + 右键菜单 |
| F8 零配置 Hook | 完成 | 8 宿主自动安装 |
| F10 设置面板 | 完成 | 8 宿主状态 + 安装/卸载 |

## 支持的 Agent 宿主（8 个）
Claude Code / Codex CLI / Claude Desktop / Antigravity / OpenCode / Qwen Code / CodeBuddy / Windsurf

## 支持的 Agent 宿主（10 种类型）
Claude Code / Codex CLI / Claude Desktop / Antigravity / OpenCode / Qwen Code / CodeBuddy / Windsurf / Cursor / Unknown

## 待实现
- F7 音效提醒（rodio 集成）
- F9 Plan Review（Markdown 预览）
- 正式应用图标
- Windows Toast 通知（已集成 winrt-toast，需测试）
- Token 用量统计
- 首次启动引导
- CSS 动画完善（T1 部分已有，需补充）
- 面板外点击折叠（T3）
- 窗口位置记忆（T9）
