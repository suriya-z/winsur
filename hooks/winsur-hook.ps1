# Winsur - forward agent hook events to local HTTP server
# Supports Claude Code / Codex / Grok Build / Cursor-style stdin JSON
#
# ASCII only on purpose: this file is read by both Windows PowerShell 5.1 and
# pwsh, which disagree about the encoding of a BOM-less file. Non-ASCII text
# here comes back mojibaked.

param(
    [Parameter(Position = 0)]
    [string]$EventName = "Unknown",
    [Parameter(Position = 1)]
    [string]$HostHint = ""
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

# Normalize Grok camelCase -> snake_case the server expects
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

# Antigravity normalization
if ($payload.conversationId -and -not $payload.session_id) {
    Ensure-Prop $payload "session_id" $payload.conversationId
}
if ($payload.toolCall) {
    if ($payload.toolCall.name -and -not $payload.tool_name) {
        Ensure-Prop $payload "tool_name" $payload.toolCall.name
    }
    if ($payload.toolCall.args -and -not $payload.tool_input) {
        Ensure-Prop $payload "tool_input" $payload.toolCall.args
    }
}
if ($payload.workspacePaths -and -not $payload.cwd) {
    $w = $payload.workspacePaths
    if ($w -is [System.Collections.IEnumerable] -and -not ($w -is [string])) {
        foreach ($first in $w) { Ensure-Prop $payload "cwd" $first; break }
    } else {
        Ensure-Prop $payload "cwd" $w
    }
}
if (-not $payload.agent_type -and ($payload.conversationId -or $payload.toolCall)) {
    Ensure-Prop $payload "agent_type" "antigravity"
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
elseif ($HostHint -and $HostHint -ne "") { $agentType = $HostHint }
elseif ($payload.conversationId -or $payload.toolCall) { $agentType = "antigravity" }
elseif ($payload.profile -and $payload.delivery_id) { $agentType = "hermes" }
elseif ($env:GROK_SESSION_ID -or $env:GROK_HOOK_EVENT -or $env:GROK_WORKSPACE_ROOT) { $agentType = "grok-build" }
elseif ($env:CLAUDE_SESSION_ID) { $agentType = "claude-code" }
elseif ($env:CODEX_SESSION_ID) { $agentType = "codex" }
elseif ($env:QWEN_SESSION_ID) { $agentType = "qwen-code" }
elseif ($env:GEMINI_SESSION_ID) { $agentType = "gemini" }
Ensure-Prop $payload "agent_type" $agentType

# Always non-blocking status endpoint (never hang agent tools)
$endpoint = "$BASE_URL/hooks/event"
$jsonBody = $payload | ConvertTo-Json -Depth 12 -Compress

try {
    Invoke-RestMethod -Uri $endpoint -Method Post -Body $jsonBody -ContentType "application/json; charset=utf-8" -TimeoutSec $TIMEOUT_SEC | Out-Null
} catch {
    # Island offline - fail open
}

# Antigravity requires valid JSON on stdout for every hook event
if ($agentType -eq "antigravity" -or $payload.conversationId -or $payload.toolCall) {
    if ($resolvedEvent -eq "PreToolUse") {
        Write-Output '{"decision":"allow"}'
    } elseif ($resolvedEvent -eq "Stop") {
        Write-Output '{"decision":"stop"}'
    } else {
        Write-Output '{}'
    }
    exit 0
}

# Report only. Exiting 0 with no output means "no decision", which leaves the
# agent's own permission flow intact. Do not print a decision here: gating runs
# over the blocking /hooks/permission endpoint, and only for hosts whose
# PreToolUse decision protocol is known (see electron/hooks.cjs).
exit 0
