# Launch a built winsur.exe and assert the notch window is actually on screen.
# Windows PowerShell 5.1 (System.Drawing). The release binary has no console;
# it writes %APPDATA%\Winsur\winsur.log.
param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [string]$Label = "window",
    [string]$OutDir = "smoke-out",
    [int]$WaitSec = 25
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $Exe)) {
    Write-Error "missing exe: $Exe"
    exit 1
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinsurSmoke {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int count);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int count);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
[WinsurSmoke]::SetProcessDPIAware() | Out-Null
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

function Stop-Winsur {
    Get-Process -Name winsur, Winsur -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 400
}

$script:smokeWindows = New-Object System.Collections.ArrayList
$script:smokePid = [uint32]0
$script:enumProc = [WinsurSmoke+EnumProc]{
    param($hwnd, $lparam)
    [uint32]$owner = 0
    [WinsurSmoke]::GetWindowThreadProcessId($hwnd, [ref]$owner) | Out-Null
    if ($owner -ne $script:smokePid) { return $true }
    $title = New-Object System.Text.StringBuilder 256
    $class = New-Object System.Text.StringBuilder 256
    [WinsurSmoke]::GetWindowText($hwnd, $title, 256) | Out-Null
    [WinsurSmoke]::GetClassName($hwnd, $class, 256) | Out-Null
    $rect = New-Object WinsurSmoke+RECT
    [WinsurSmoke]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
    [void]$script:smokeWindows.Add([pscustomobject]@{
        Hwnd    = [int64]$hwnd
        Visible = [WinsurSmoke]::IsWindowVisible($hwnd)
        Title   = $title.ToString()
        Class   = $class.ToString()
        Left    = $rect.Left
        Top     = $rect.Top
        Right   = $rect.Right
        Bottom  = $rect.Bottom
        Width   = $rect.Right - $rect.Left
        Height  = $rect.Bottom - $rect.Top
    })
    return $true
}

function Get-WinsurWindows([uint32]$ProcessId) {
    $script:smokePid = $ProcessId
    $script:smokeWindows = New-Object System.Collections.ArrayList
    [WinsurSmoke]::EnumWindows($script:enumProc, [IntPtr]::Zero) | Out-Null
    return @($script:smokeWindows)
}

Stop-Winsur
$log = Join-Path $env:APPDATA "Winsur\winsur.log"
if (Test-Path -LiteralPath $log) {
    Remove-Item -LiteralPath $log -Force
}

Write-Output "launching $Exe --smoke-test ($Label)"
$proc = Start-Process -FilePath $Exe -ArgumentList "--smoke-test" -PassThru
$vx = [WinsurSmoke]::GetSystemMetrics(76)
$vy = [WinsurSmoke]::GetSystemMetrics(77)
$vw = [WinsurSmoke]::GetSystemMetrics(78)
$vh = [WinsurSmoke]::GetSystemMetrics(79)
Write-Output "virtual screen $vx,$vy ${vw}x${vh}"

$chosen = $null
$logPartial = ""
for ($i = 1; $i -le $WaitSec; $i++) {
    Start-Sleep -Seconds 1
    if ($proc.HasExited) {
        Write-Output "process exited early code=$($proc.ExitCode) after ${i}s"
        break
    }
    $windows = @(Get-WinsurWindows ([uint32]$proc.Id))
    $windows | ForEach-Object {
        Write-Output ("hwnd={0} visible={1} {2}x{3} @ {4},{5} title='{6}' class='{7}'" -f $_.Hwnd, $_.Visible, $_.Width, $_.Height, $_.Left, $_.Top, $_.Title, $_.Class)
    }
    $hit = $windows | Where-Object {
        $_.Visible -and $_.Width -ge 200 -and $_.Height -ge 80 -and
        $_.Right -gt $vx -and $_.Left -lt ($vx + $vw) -and
        $_.Bottom -gt $vy -and $_.Top -lt ($vy + $vh)
    } | Sort-Object Width -Descending | Select-Object -First 1
    if ($hit) { $chosen = $hit }
    if (Test-Path -LiteralPath $log) { $logPartial = Get-Content -LiteralPath $log -Raw }
    if ($logPartial -match "smoke=fail") { break }
    if ($chosen -and $logPartial -match "smoke=ok") { break }
}

$png = Join-Path $OutDir "$Label.png"
$shotNote = "screenshot-skipped"
try {
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object System.Drawing.Bitmap ([Math]::Max(1, $bounds.Width)), ([Math]::Max(1, $bounds.Height))
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    $graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bmp.Size)
    $bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $shotNote = "screenshot=$png ${bounds.Width}x${bounds.Height}"
    Write-Output $shotNote
} catch {
    Write-Output "screenshot failed: $($_.Exception.Message)"
    $bmp = $null
    $bounds = $null
}

$dark = 0
$sampled = 0
if ($chosen -and $bmp) {
    $cx = [int](($chosen.Left + $chosen.Right) / 2)
    $cy = [int](($chosen.Top + $chosen.Bottom) / 2)
    for ($y = $cy - 8; $y -le $cy + 8; $y++) {
        for ($x = $cx - 30; $x -le $cx + 30; $x++) {
            $px = $x - $bounds.X
            $py = $y - $bounds.Y
            if ($px -lt 0 -or $py -lt 0 -or $px -ge $bmp.Width -or $py -ge $bmp.Height) { continue }
            $color = $bmp.GetPixel($px, $py)
            $sampled++
            if ($color.R -lt 48 -and $color.G -lt 48 -and $color.B -lt 48) { $dark++ }
        }
    }
    Write-Output "island sample dark=$dark / $sampled at $cx,$cy"
}
if ($bmp) { $bmp.Dispose() }

if (-not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}
Stop-Winsur

$logText = ""
if (Test-Path -LiteralPath $log) {
    $logText = Get-Content -LiteralPath $log -Raw
    $logCopy = Join-Path $OutDir "$Label.log"
    Copy-Item -LiteralPath $log -Destination $logCopy -Force
    Write-Output "----- $log -----"
    Write-Output $logText
} else {
    Write-Output "log file missing: $log"
}

$fail = @()
if (-not $chosen) { $fail += "no visible non-zero on-screen top-level window" }
if ($sampled -lt 20 -or $dark -lt ($sampled * 0.4)) { $fail += "island pixels not painted (dark $dark / $sampled)" }
if ($logText -notmatch "frontend=embedded") { $fail += "log missing frontend=embedded" }
if ($logText -notmatch "tray ready") { $fail += "log missing tray ready" }
if ($logText -notmatch "island painted") { $fail += "log missing island painted" }
if ($logText -notmatch "smoke=ok") { $fail += "log missing smoke=ok" }

if ($fail.Count -gt 0) {
    Write-Output "FAIL ${Label}:"
    $fail | ForEach-Object { Write-Output "  - $_" }
    exit 1
}
Write-Output "PASS $Label"
exit 0
