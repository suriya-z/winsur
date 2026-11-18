// Winsur — reliable type-into-agent + jump (Windows)
//
// Window discovery uses EnumWindows (NOT Process.MainWindowHandle).
// Windows Terminal often reports MainWindowHandle=0 while the real HWND is live —
// that was a root cause of FAIL|NO_WINDOW and false "sent" on older paths.
//
// Send only returns ok:true when:
//  1) A scored terminal HWND was found
//  2) Foreground actually became that HWND
//  3) Clipboard + SendInput Ctrl+V + Enter completed

const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

function agentKeywords(agentType) {
  try {
    const { getAgentRegistry, getTerminalHints } = require("./agents-registry.cjs");
    const reg = getAgentRegistry().find((a) => a.typeId === agentType);
    const hints = [...(reg?.windowHints || []), ...getTerminalHints()];
    if (hints.length) return hints;
  } catch {
    /* ignore */
  }
  return [
    "Windows Terminal",
    "Terminal",
    "cmd",
    "powershell",
    "pwsh",
    "WezTerm",
    "VS Code",
    "Cursor",
    "grok",
    "claude",
    "codex",
  ];
}

function preferName(agentType) {
  if (agentType === "grok-build") return "grok";
  if (agentType === "claude-code" || agentType === "claude-desktop") return "claude";
  if (agentType === "codex") return "codex";
  if (agentType === "cursor") return "cursor";
  if (agentType === "hermes") return "hermes";
  return "grok";
}

function buildNeedleList(cwd, name, agentType) {
  const last = String(cwd || "")
    .split(/[/\\]/)
    .filter(Boolean)
    .pop();
  const blocked = /^(users|documents|desktop|downloads|acer|admin|user|onedrive)$/i;
  const safeName =
    name && String(name).length >= 4 && !blocked.test(name) ? name : null;
  const safeLast =
    last && String(last).length >= 4 && !blocked.test(last) ? last : null;
  return [
    ...new Set(
      [...agentKeywords(agentType), safeName, safeLast].filter(Boolean)
    ),
  ];
}

/**
 * PowerShell single-quoted literal. PowerShell also ends a single-quoted
 * string on the curly quotes, so those are doubled too.
 */
function psQuote(value) {
  return `'${String(value).replace(/['\u2018\u2019\u201A\u201B]/g, "$&$&")}'`;
}

async function runPsFile(scriptBody) {
  const file = path.join(
    os.tmpdir(),
    `winsur-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`
  );
  // BOM: powershell.exe 5.1 reads a BOM-less file as ANSI, which mangles
  // non-ASCII folder names and can turn their bytes into quote characters.
  fs.writeFileSync(file, "\uFEFF" + scriptBody, "utf8");
  try {
    const { stdout, stderr } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file],
      { windowsHide: true, timeout: 25000, maxBuffer: 4 * 1024 * 1024 }
    );
    return { stdout: String(stdout || "").trim(), stderr: String(stderr || "").trim() };
  } catch (e) {
    return {
      stdout: String(e.stdout || "").trim(),
      stderr: String(e.stderr || e.message || "").trim(),
    };
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}

const FOCUS_CS = `
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

public class WinsurWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();

  public const int SW_RESTORE = 9;
  public const int SW_SHOW = 5;
  public const uint WM_SYSCOMMAND = 0x0112;
  public const int SC_RESTORE = 0xF120;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const byte VK_CONTROL = 0x11;
  public const byte VK_MENU = 0x12;
  public const byte VK_V = 0x56;
  public const byte VK_RETURN = 0x0D;

  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint type; public INPUTUNION u; }
  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION { [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
  }

  public class WinInfo {
    public long Hwnd;
    public uint Pid;
    public string Title;
    public string ClassName;
    public string ProcName;
    public int Score;
  }

  static string GetTitle(IntPtr h) {
    int len = GetWindowTextLength(h);
    if (len <= 0) return "";
    var sb = new StringBuilder(len + 1);
    GetWindowText(h, sb, sb.Capacity);
    return sb.ToString();
  }
  static string GetCls(IntPtr h) {
    var sb = new StringBuilder(256);
    GetClassName(h, sb, sb.Capacity);
    return sb.ToString();
  }

  public static List<WinInfo> ListTopWindows() {
    var list = new List<WinInfo>();
    EnumWindows((h, l) => {
      string title = GetTitle(h);
      if (string.IsNullOrWhiteSpace(title)) return true;
      // Skip tool/IME chrome
      if (title == "Default IME" || title == "MSCTFIME UI" || title == "DDE Server Window") return true;
      if (title.IndexOf("Winsur", StringComparison.OrdinalIgnoreCase) >= 0) return true;
      if (title.IndexOf("Vibe Island", StringComparison.OrdinalIgnoreCase) >= 0) return true;

      uint pid;
      GetWindowThreadProcessId(h, out pid);
      string cls = GetCls(h);
      string proc = "";
      try {
        var p = System.Diagnostics.Process.GetProcessById((int)pid);
        proc = p.ProcessName ?? "";
      } catch { proc = ""; }

      string pl = proc.ToLowerInvariant();
      // Terminal hosts are often IsWindowVisible=false (cloaked / WinUI) while still on-screen
      bool isTermHost =
        pl.Contains("windowsterminal") || pl == "cmd" || pl == "powershell" || pl == "pwsh" ||
        pl.Contains("wezterm") || pl.Contains("alacritty") || pl.Contains("openconsole") ||
        cls.IndexOf("CASCADIA", StringComparison.OrdinalIgnoreCase) >= 0 ||
        cls.IndexOf("ConsoleWindowClass", StringComparison.OrdinalIgnoreCase) >= 0;

      if (!IsWindowVisible(h) && !isTermHost) return true;

      // Skip obvious non-terminals
      if (pl.Contains("rainmeter") || pl.Contains("wallpaper") || pl.Contains("chrome") ||
          pl.Contains("msedge") || pl.Contains("firefox") || pl.Contains("discord") ||
          pl.Contains("spotify") || pl.Contains("slack") || pl.Contains("telegram") ||
          pl.Contains("notepad") || pl == "explorer" || pl.Contains("applicationframehost") ||
          pl.Contains("systemsettings") || pl.Contains("textinputhost") || pl.Contains("searchhost") ||
          pl.Contains("shellexperiencehost") || pl.Contains("startmenuexperiencehost")) {
        return true;
      }

      list.Add(new WinInfo {
        Hwnd = h.ToInt64(),
        Pid = pid,
        Title = title,
        ClassName = cls,
        ProcName = proc,
        Score = 0
      });
      return true;
    }, IntPtr.Zero);
    return list;
  }

  static INPUT Key(ushort vk, bool up) {
    INPUT i = new INPUT();
    i.type = 1;
    i.u.ki.wVk = vk;
    i.u.ki.dwFlags = up ? KEYEVENTF_KEYUP : 0u;
    return i;
  }

  public static void TapAlt() {
    INPUT[] i = new INPUT[] { Key(VK_MENU, false), Key(VK_MENU, true) };
    SendInput(2, i, Marshal.SizeOf(typeof(INPUT)));
  }

  public static bool Force(long hwndL) {
    IntPtr hwnd = new IntPtr(hwndL);
    if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return false;
    AllowSetForegroundWindow(-1);
    if (IsIconic(hwnd)) {
      PostMessage(hwnd, WM_SYSCOMMAND, new IntPtr(SC_RESTORE), IntPtr.Zero);
      ShowWindow(hwnd, SW_RESTORE);
      Thread.Sleep(100);
    } else {
      ShowWindow(hwnd, SW_SHOW);
    }
    TapAlt();
    uint dummy;
    uint fgTid = GetWindowThreadProcessId(GetForegroundWindow(), out dummy);
    uint cur = GetCurrentThreadId();
    uint tgtTid = GetWindowThreadProcessId(hwnd, out dummy);
    bool a1 = false, a2 = false;
    if (fgTid != cur) a1 = AttachThreadInput(cur, fgTid, true);
    if (tgtTid != cur && tgtTid != fgTid) a2 = AttachThreadInput(cur, tgtTid, true);
    BringWindowToTop(hwnd);
    bool ok = SetForegroundWindow(hwnd);
    if (a2) AttachThreadInput(cur, tgtTid, false);
    if (a1) AttachThreadInput(cur, fgTid, false);
    Thread.Sleep(70);
    if (GetForegroundWindow() != hwnd) {
      TapAlt();
      ok = SetForegroundWindow(hwnd) || ok;
      Thread.Sleep(90);
    }
    return GetForegroundWindow() == hwnd || ok;
  }

  public static bool IsFg(long hwndL) {
    IntPtr hwnd = new IntPtr(hwndL);
    return hwnd != IntPtr.Zero && GetForegroundWindow() == hwnd;
  }

  public static void PasteAndEnter() {
    INPUT[] paste = new INPUT[] {
      Key(VK_CONTROL, false),
      Key(VK_V, false),
      Key(VK_V, true),
      Key(VK_CONTROL, true)
    };
    SendInput(4, paste, Marshal.SizeOf(typeof(INPUT)));
    Thread.Sleep(180);
    INPUT[] ent = new INPUT[] {
      Key(VK_RETURN, false),
      Key(VK_RETURN, true)
    };
    SendInput(2, ent, Marshal.SizeOf(typeof(INPUT)));
  }
}
`;

/**
 * @param {{ allowAnyConsole?: boolean }} opts  allowAnyConsole: when nothing
 *   matches, fall back to any console window. Fine for a jump; never for a
 *   send, which would paste the message into an unrelated shell and run it.
 */
function scoreAndPickPs(needlesPs, preferAgent, { allowAnyConsole = false } = {}) {
  const prefer = String(preferAgent || "").replace(/'/g, "");
  return `
$needles = @(${needlesPs})
$preferAgent = '${prefer}'

# Agent CLI process for tree bonus
$agentProc = $null
if ($preferAgent) {
  $agentProc = Get-Process -Name $preferAgent -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $agentProc -and $preferAgent) {
  $agentProc = Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -match [regex]::Escape($preferAgent) } |
    Select-Object -First 1
}
$agentPid = if ($agentProc) { [int]$agentProc.Id } else { 0 }

# Walk parents of agent PID
$agentTree = New-Object 'System.Collections.Generic.HashSet[int]'
if ($agentPid -gt 0) {
  $cur = $agentPid
  for ($i = 0; $i -lt 16 -and $cur -gt 0; $i++) {
    [void]$agentTree.Add($cur)
    try {
      $row = Get-CimInstance Win32_Process -Filter "ProcessId=$cur" -ErrorAction SilentlyContinue
      if (-not $row) { break }
      $cur = [int]$row.ParentProcessId
    } catch { break }
  }
}

$wins = [WinsurWin]::ListTopWindows()
$scored = @()
foreach ($w in $wins) {
  $tl = $w.Title.ToLowerInvariant()
  $pn = ($w.ProcName + '').ToLowerInvariant()
  $cls = ($w.ClassName + '').ToLowerInvariant()
  $score = 0

  $isHost = $pn -match 'windowsterminal|cmd|powershell|pwsh|wezterm|alacritty|windowsterminal' -or
            $cls -match 'cascadia|consolewindowclass|mintty'
  $titleAgent = $tl -match 'grok|claude|codex|cursor|terminal|powershell|cmd\\.exe|pwsh'
  if (-not $isHost -and -not $titleAgent -and $pn -notmatch 'code|cursor|devenv') { continue }

  foreach ($n in $needles) {
    if ([string]::IsNullOrWhiteSpace($n)) { continue }
    if ($tl.Contains($n.ToLowerInvariant())) { $score += 10 + [Math]::Min($n.Length, 20) }
  }

  if ($pn -match 'windowsterminal') { $score += 30 }
  if ($cls -match 'cascadia') { $score += 20 }
  if ($pn -match '^(cmd|powershell|pwsh)$') { $score += 12 }
  if ($pn -match '^(code|cursor)$') { $score += 8 }

  if ($tl -match 'grok') { $score += 130 }
  if ($tl -match 'claude') { $score += 90 }
  if ($tl -match 'codex') { $score += 90 }
  if ($tl -match 'hermes' -and $preferAgent -eq 'grok') { $score -= 150 }
  if ($tl -match 'rainmeter|player\\.ini') { $score -= 250 }

  if ($preferAgent -and $tl.Contains($preferAgent)) { $score += 200 }
  if ($preferAgent -and $pn.Contains($preferAgent)) { $score += 80 }

  if ($agentTree.Contains([int]$w.Pid)) { $score += 400 }

  if ($score -gt 0) {
    $scored += [pscustomobject]@{
      Score = $score
      Pid   = [int]$w.Pid
      Title = $w.Title
      Hwnd  = [int64]$w.Hwnd
      Proc  = $w.ProcName
      Class = $w.ClassName
    }
  }
}
${allowAnyConsole ? anyConsoleFallbackPs() : ""}
$script:Best = $scored | Sort-Object Score -Descending | Select-Object -First 1
$script:AgentPid = $agentPid
$script:Top3 = ($scored | Sort-Object Score -Descending | Select-Object -First 3 |
  ForEach-Object { "$($_.Score):$($_.Proc):$($_.Title)" }) -join ' || '
$script:WinCount = $wins.Count
`;
}

function anyConsoleFallbackPs() {
  return `
# Last-resort: any Cascadia/console window
if ($scored.Count -eq 0) {
  foreach ($w in $wins) {
    $pn = ($w.ProcName + '').ToLowerInvariant()
    $cls = ($w.ClassName + '').ToLowerInvariant()
    if ($pn -match 'windowsterminal|cmd|powershell|pwsh|wezterm' -or $cls -match 'cascadia|consolewindowclass') {
      $score = 5
      $tl = $w.Title.ToLowerInvariant()
      if ($preferAgent -and $tl.Contains($preferAgent)) { $score = 250 }
      if ($agentTree.Contains([int]$w.Pid)) { $score += 400 }
      $scored += [pscustomobject]@{
        Score = $score; Pid = [int]$w.Pid; Title = $w.Title
        Hwnd = [int64]$w.Hwnd; Proc = $w.ProcName; Class = $w.ClassName
      }
    }
  }
}
`;
}

function addTypeBlock() {
  return `
Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
$added = $false
try {
  Add-Type @"
${FOCUS_CS}
"@
  $added = $true
} catch {
  if ($_.Exception.Message -match 'already exists') { $added = $true }
  else {
    Write-Output ("FAIL|ADDTYPE|" + $_.Exception.Message)
    exit 5
  }
}
`;
}

/**
 * Reliable send: EnumWindows → Force FG → VERIFY FG → clipboard → SendInput paste+enter
 */
async function sendTextToWindow(cwd, name, agentType, message) {
  const text = String(message || "");
  if (!text.trim()) return { ok: false, detail: "empty message", background: false };

  const needles = buildNeedleList(cwd, name, agentType);
  const needlesPs = needles.map(psQuote).join(", ");
  const b64 = Buffer.from(text, "utf16le").toString("base64");
  const prefer = preferName(agentType);

  const script = `
$ErrorActionPreference = 'Continue'
${addTypeBlock()}
${scoreAndPickPs(needlesPs, prefer)}
if (-not $Best) {
  $alive = @(Get-Process -Name grok,claude,codex -ErrorAction SilentlyContinue)
  if ($alive.Count -eq 0) { Write-Output 'FAIL|AGENT_EXITED'; exit 2 }
  Write-Output ("FAIL|NO_WINDOW|wins=$WinCount")
  exit 2
}
Write-Output ("PICK|$($Best.Score)|$($Best.Proc)|$($Best.Pid)|hwnd=$($Best.Hwnd)|agentPid=$AgentPid|$($Best.Title)")
Write-Output ("CAND|$Top3")

$hwndL = [int64]$Best.Hwnd
$forceOk = [WinsurWin]::Force($hwndL)
Start-Sleep -Milliseconds 280

$wshell = New-Object -ComObject WScript.Shell
try { [void]$wshell.AppActivate([int]$Best.Pid) } catch {}
Start-Sleep -Milliseconds 180

$fgOk = [WinsurWin]::IsFg($hwndL)
if (-not $fgOk) {
  $forceOk = [WinsurWin]::Force($hwndL)
  Start-Sleep -Milliseconds 220
  $fgOk = [WinsurWin]::IsFg($hwndL)
}
if (-not $fgOk) {
  Write-Output ("FAIL|NO_FOCUS|force=$forceOk|title=" + $Best.Title)
  exit 3
}

$bytes = [Convert]::FromBase64String('${b64}')
$text = [Text.Encoding]::Unicode.GetString($bytes)
try {
  [System.Windows.Forms.Clipboard]::SetText($text)
} catch {
  try { Set-Clipboard -Value $text } catch {
    Write-Output ("FAIL|CLIPBOARD|" + $_.Exception.Message)
    exit 4
  }
}

if (-not [WinsurWin]::IsFg($hwndL)) {
  [void][WinsurWin]::Force($hwndL)
  Start-Sleep -Milliseconds 160
  if (-not [WinsurWin]::IsFg($hwndL)) {
    Write-Output ("FAIL|LOST_FOCUS_BEFORE_PASTE|title=" + $Best.Title)
    exit 3
  }
}

Start-Sleep -Milliseconds 60
[WinsurWin]::PasteAndEnter()
Start-Sleep -Milliseconds 400

Write-Output ("OK|force=$forceOk|fg=True|proc=$($Best.Proc)|title=" + $Best.Title)
exit 0
`;

  const { stdout, stderr } = await runPsFile(script);
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const joined = lines.join(" | ");
  const okLine = lines.find((l) => l.startsWith("OK|"));
  if (okLine) {
    return { ok: true, detail: joined, background: false };
  }
  return {
    ok: false,
    detail: joined || stderr || "send failed — leave the Grok/agent terminal open and visible",
    background: false,
  };
}

async function focusTerminal(cwd, name, agentType) {
  const needles = buildNeedleList(cwd, name, agentType);
  const needlesPs = needles.map(psQuote).join(", ");
  const prefer = preferName(agentType);

  const script = `
$ErrorActionPreference = 'Continue'
${addTypeBlock()}
${scoreAndPickPs(needlesPs, prefer, { allowAnyConsole: true })}
if (-not $Best) {
  $alive = @(Get-Process -Name grok,claude,codex -ErrorAction SilentlyContinue)
  if ($alive.Count -eq 0) { Write-Output 'FAIL|AGENT_EXITED'; exit 1 }
  Write-Output ("FAIL|NO_WINDOW|wins=$WinCount")
  exit 1
}
$hwndL = [int64]$Best.Hwnd
$ok = [WinsurWin]::Force($hwndL)
$w = New-Object -ComObject WScript.Shell
try { [void]$w.AppActivate([int]$Best.Pid) } catch {}
Start-Sleep -Milliseconds 140
$fg = [WinsurWin]::IsFg($hwndL)
Write-Output ("OK|$ok|$fg|$($Best.Proc)|score=$($Best.Score)|$($Best.Title)")
`;

  const { stdout } = await runPsFile(script);
  const out = String(stdout || "").trim();
  const line = out.split(/\r?\n/).filter(Boolean).pop() || "";
  if (line.startsWith("OK|")) {
    const parts = line.split("|");
    const ok = /true/i.test(parts[1] || "") || /true/i.test(parts[2] || "");
    return { ok, detail: line };
  }
  return { ok: false, detail: out || "jump failed" };
}

async function focusWindowByKeywords(keywords) {
  return focusTerminal("", keywords?.[0] || "", "unknown");
}

module.exports = {
  focusTerminal,
  sendTextToWindow,
  focusWindowByKeywords,
  agentKeywords,
  psQuote,
  runPsFile,
  scoreAndPickPs,
};
