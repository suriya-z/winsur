# Vibe Island — forward agent hook events to local HTTP server
# Supports Claude Code / Codex / Grok Build / Cursor-style stdin JSON

param(
    [Parameter(Position = 0)]
    [string]$EventName = "Unknown"
)

$ErrorActionPreference = "SilentlyContinue"
$VIBE_ISLAND_PORT = if ($env:VIBE_ISLAND_PORT) { $env:VIBE_ISLAND_PORT } else { "18900" }
$BASE_URL = "http://127.0.0.1:$VIBE_ISLAND_PORT"
# Keep short so Grok/Claude hooks fail-open fast if island is down
$TIMEOUT_SEC = 3

# Read full stdin
$stdinData = ""
try {
    $stdinData = [Console]::In.ReadToEnd()
} catch {}
if (-not $stdinData -or $stdinData.Trim() -eq "") { $stdinData = "{}" }

try {
    $payload = $stdinData | ConvertFrom-Json -ErrorAction Stop
} catch {
    $payload = [pscustomobject]@{}
}

function Ensure-Prop($obj, $name, $value) {
    if ($null -eq $obj) { return }
    if (Get-Member -InputObject $obj -Name $name -MemberType NoteProperty -ErrorAction SilentlyContinue) {
        if (-not $obj.$name) { $obj.$name = $value }
    } else {
        $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value -Force
    }
}

# Normalize Grok camelCase → snake_case the server expects
if ($payload.hookEventName -and -not $payload.hook_event_name) {
    Ensure-Prop $payload "hook_event_name" $payload.hookEventName
}
if ($payload.sessionId -and -not $payload.session_id) {
    Ensure-Prop $payload "session_id" $payload.sessionId
}
if ($payload.toolName -and -not $payload.tool_name) {
    Ensure-Prop $payload "tool_name" $payload.toolName
}
if ($payload.toolInput -and -not $payload.tool_input) {
    Ensure-Prop $payload "tool_input" $payload.toolInput
}
if ($payload.workspaceRoot -and -not $payload.cwd) {
    Ensure-Prop $payload "cwd" $payload.workspaceRoot
}
if ($payload.notificationType -and -not $payload.notification_type) {
    Ensure-Prop $payload "notification_type" $payload.notificationType
}

# Event name (CLI arg or payload or env)
$resolvedEvent = $EventName
if ($resolvedEvent -eq "Unknown" -or -not $resolvedEvent) {
    if ($payload.hook_event_name) { $resolvedEvent = $payload.hook_event_name }
    elseif ($payload.hookEventName) { $resolvedEvent = $payload.hookEventName }
    elseif ($env:GROK_HOOK_EVENT) { $resolvedEvent = $env:GROK_HOOK_EVENT }
}
Ensure-Prop $payload "hook_event_name" $resolvedEvent

# Session id
$sessionId = $null
if ($payload.session_id) { $sessionId = $payload.session_id }
elseif ($payload.sessionId) { $sessionId = $payload.sessionId }
elseif ($env:GROK_SESSION_ID) { $sessionId = $env:GROK_SESSION_ID }
elseif ($env:CLAUDE_SESSION_ID) { $sessionId = $env:CLAUDE_SESSION_ID }
elseif ($env:CODEX_SESSION_ID) { $sessionId = $env:CODEX_SESSION_ID }
elseif ($env:AGENT_SESSION_ID) { $sessionId = $env:AGENT_SESSION_ID }
else { $sessionId = [guid]::NewGuid().ToString() }
Ensure-Prop $payload "session_id" $sessionId

# cwd
$cwd = $null
if ($payload.cwd) { $cwd = $payload.cwd }
elseif ($payload.workspaceRoot) { $cwd = $payload.workspaceRoot }
elseif ($env:GROK_WORKSPACE_ROOT) { $cwd = $env:GROK_WORKSPACE_ROOT }
elseif ($env:CLAUDE_PROJECT_DIR) { $cwd = $env:CLAUDE_PROJECT_DIR }
else { $cwd = (Get-Location).Path }
Ensure-Prop $payload "cwd" $cwd

# Agent type
$agentType = "unknown"
if ($payload.agent_type) { $agentType = $payload.agent_type }
elseif ($env:GROK_SESSION_ID -or $env:GROK_HOOK_EVENT -or $env:GROK_WORKSPACE_ROOT) { $agentType = "grok-build" }
elseif ($env:CLAUDE_SESSION_ID) { $agentType = "claude-code" }
elseif ($env:CODEX_SESSION_ID) { $agentType = "codex" }
Ensure-Prop $payload "agent_type" $agentType

# Always non-blocking status endpoint (never hang agent tools)
$endpoint = "$BASE_URL/hooks/event"
$jsonBody = $payload | ConvertTo-Json -Depth 12 -Compress

try {
    Invoke-RestMethod -Uri $endpoint -Method Post -Body $jsonBody -ContentType "application/json; charset=utf-8" -TimeoutSec $TIMEOUT_SEC | Out-Null
} catch {
    # Island offline — fail open
}

# Grok/Claude PreToolUse allow
if ($resolvedEvent -match "PreToolUse|pre_tool_use|preToolUse") {
    Write-Output '{"decision":"allow"}'
}
exit 0
