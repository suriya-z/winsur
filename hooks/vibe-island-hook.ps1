# Vibe Island Win - Agent Hook 脚本 v2
# 功能：接收 Agent 事件（stdin JSON），转发到 Vibe Island HTTP 服务器
# 支持：Claude Code / Codex / Antigravity / OpenCode / Qwen Code / CodeBuddy / Windsurf
#
# 安装方式（自动）：在 Vibe Island 设置面板中点击 "Install All"
# 安装方式（手动）：将此脚本路径添加到 Agent 的 hooks 配置中

param(
    [Parameter(Position=0)]
    [string]$EventName = "Unknown"
)

# ========== 配置 ==========
$VIBE_ISLAND_PORT = if ($env:VIBE_ISLAND_PORT) { $env:VIBE_ISLAND_PORT } else { "18900" }
$BASE_URL = "http://127.0.0.1:$VIBE_ISLAND_PORT"
$TIMEOUT_SEC = 310  # 权限请求阻塞超时（5 分钟 + 10 秒缓冲）

# ========== 读取 stdin ==========
$stdinData = ""
try {
    if ([Console]::In.Peek() -ne -1) {
        $stdinData = [Console]::In.ReadToEnd()
    }
} catch {
    # stdin 可能为空或已关闭
}

if (-not $stdinData -or $stdinData.Trim() -eq "") {
    $stdinData = "{}"
}

# ========== 解析 payload ==========
try {
    $payload = $stdinData | ConvertFrom-Json -ErrorAction Stop
} catch {
    $payload = New-Object PSObject
}

# ========== 补全字段 ==========

# 事件名
if (-not (Get-Member -InputObject $payload -Name "hook_event_name" -MemberType NoteProperty)) {
    $payload | Add-Member -NotePropertyName "hook_event_name" -NotePropertyValue $EventName -Force
}

# Session ID：按优先级从环境变量获取
if (-not (Get-Member -InputObject $payload -Name "session_id" -MemberType NoteProperty) -or -not $payload.session_id) {
    $sessionId = $null
    # Claude Code
    if ($env:CLAUDE_SESSION_ID) { $sessionId = $env:CLAUDE_SESSION_ID }
    # Codex
    elseif ($env:CODEX_SESSION_ID) { $sessionId = $env:CODEX_SESSION_ID }
    # 通用
    elseif ($env:AGENT_SESSION_ID) { $sessionId = $env:AGENT_SESSION_ID }
    # 生成随机 ID
    else { $sessionId = [guid]::NewGuid().ToString() }

    $payload | Add-Member -NotePropertyName "session_id" -NotePropertyValue $sessionId -Force
}

# 工作目录
if (-not (Get-Member -InputObject $payload -Name "cwd" -MemberType NoteProperty) -or -not $payload.cwd) {
    $payload | Add-Member -NotePropertyName "cwd" -NotePropertyValue (Get-Location).Path -Force
}

# Agent 类型推断
if (-not (Get-Member -InputObject $payload -Name "agent_type" -MemberType NoteProperty) -or -not $payload.agent_type) {
    $agentType = "unknown"
    # 从 transcript_path 推断
    if (Get-Member -InputObject $payload -Name "transcript_path" -MemberType NoteProperty) {
        $tp = $payload.transcript_path.ToLower()
        if ($tp -match "\.claude") { $agentType = "claude-code" }
        elseif ($tp -match "\.codex") { $agentType = "codex" }
        elseif ($tp -match "\.cursor") { $agentType = "cursor" }
        elseif ($tp -match "antigravity") { $agentType = "antigravity" }
        elseif ($tp -match "opencode") { $agentType = "opencode" }
        elseif ($tp -match "qwen") { $agentType = "qwen-code" }
        elseif ($tp -match "codebuddy") { $agentType = "codebuddy" }
        elseif ($tp -match "windsurf") { $agentType = "windsurf" }
    }
    # 从环境变量推断
    elseif ($env:CLAUDE_SESSION_ID) { $agentType = "claude-code" }
    elseif ($env:CODEX_SESSION_ID) { $agentType = "codex" }

    $payload | Add-Member -NotePropertyName "agent_type" -NotePropertyValue $agentType -Force
}

# ========== 发送到 Vibe Island ==========
$jsonBody = $payload | ConvertTo-Json -Depth 10 -Compress

# 判断是否是权限请求（需要阻塞等待用户决策）
$isPermission = ($EventName -eq "PreToolUse") -and
    (Get-Member -InputObject $payload -Name "tool_name" -MemberType NoteProperty) -and
    $payload.tool_name

if ($isPermission) {
    $endpoint = "$BASE_URL/hooks/permission"
} else {
    $endpoint = "$BASE_URL/hooks/event"
}

try {
    $response = Invoke-RestMethod -Uri $endpoint -Method Post -Body $jsonBody -ContentType "application/json" -TimeoutSec $TIMEOUT_SEC

    if ($isPermission -and $response.decision) {
        if ($response.decision -eq "deny") {
            # 输出标准 hook 拒绝格式
            $output = @{
                error = "Permission denied by Vibe Island"
            } | ConvertTo-Json -Compress
            Write-Output $output
            exit 2
        }
        # allow - 正常退出
        exit 0
    }
} catch [System.Net.WebException] {
    # 服务器不可用 - 静默失败，不阻塞 Agent
    exit 0
} catch {
    # 其他错误 - 静默失败
    exit 0
}
