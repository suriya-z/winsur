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

$logText = ""
if (Test-Path -LiteralPath $log) { $logText = Get-Content -LiteralPath $log -Raw }
$islandHits = [regex]::Matches($logText, 'island screen x=([-0-9.]+) y=([-0-9.]+) w=([-0-9.]+) h=([-0-9.]+) visible=([-0-9.]+)x([-0-9.]+)')
$island = $null
if ($islandHits.Count -gt 0) {
    $m = $islandHits[$islandHits.Count - 1]
    $island = [pscustomobject]@{
        X    = [double]$m.Groups[1].Value
        Y    = [double]$m.Groups[2].Value
        W    = [double]$m.Groups[3].Value
        H    = [double]$m.Groups[4].Value
        VisW = [double]$m.Groups[5].Value
        VisH = [double]$m.Groups[6].Value
    }
    Write-Output ("island screen x={0} y={1} {2}x{3} visible={4}x{5}" -f $island.X, $island.Y, $island.W, $island.H, $island.VisW, $island.VisH)
}

$png = Join-Path $OutDir "$Label.png"
$shotNote = "screenshot-skipped"
function Copy-VirtualScreen([System.Drawing.CopyPixelOperation]$Op) {
    $screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $image = New-Object System.Drawing.Bitmap ([Math]::Max(1, $screen.Width)), ([Math]::Max(1, $screen.Height))
    $graphics = [System.Drawing.Graphics]::FromImage($image)
    $graphics.CopyFromScreen($screen.X, $screen.Y, 0, 0, $image.Size, $Op)
    $graphics.Dispose()
    return $image
}

try {
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    # Click-through marks the HWND layered. CaptureBlt includes those pixels.
    # If that flag comes back black on the VM, fall back to the plain desktop copy.
    $capture = [System.Drawing.CopyPixelOperation]([int][System.Drawing.CopyPixelOperation]::SourceCopy -bor [int][System.Drawing.CopyPixelOperation]::CaptureBlt)
    $bmp = Copy-VirtualScreen $capture
    $blackish = 0
    for ($i = 0; $i -lt 16; $i++) {
        $sample = $bmp.GetPixel([int]($bmp.Width * ($i + 0.5) / 16), [int]($bmp.Height / 2))
        if ($sample.R -lt 8 -and $sample.G -lt 8 -and $sample.B -lt 8) { $blackish++ }
    }
    if ($blackish -ge 14) {
        Write-Output "captureblt looked black; retrying without it"
        $bmp.Dispose()
        $bmp = Copy-VirtualScreen ([System.Drawing.CopyPixelOperation]::SourceCopy)
    }
    $bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
    $shotNote = "screenshot=$png ${bounds.Width}x${bounds.Height}"
    Write-Output $shotNote
} catch {
    Write-Output "screenshot failed: $($_.Exception.Message)"
    $bmp = $null
    $bounds = $null
}

$dark = 0
$sampled = 0
if ($island -and $bmp -and $island.W -gt 8 -and $island.H -gt 8) {
    # Sample the pill interior. The window is mostly a transparent gutter, and
    # the caption sits in the middle, so a small center patch can be glyph ink
    # or wallpaper from the wrong place.
    $x0 = [int][Math]::Ceiling($island.X + 3)
    $y0 = [int][Math]::Ceiling($island.Y + 3)
    $x1 = [int][Math]::Floor($island.X + $island.W - 4)
    $y1 = [int][Math]::Floor($island.Y + $island.H - 4)
    for ($y = $y0; $y -le $y1; $y += 2) {
        for ($x = $x0; $x -le $x1; $x += 2) {
            $px = $x - $bounds.X
            $py = $y - $bounds.Y
            if ($px -lt 0 -or $py -lt 0 -or $px -ge $bmp.Width -or $py -ge $bmp.Height) { continue }
            $color = $bmp.GetPixel($px, $py)
            $sampled++
            if ($color.R -lt 48 -and $color.G -lt 48 -and $color.B -lt 48) { $dark++ }
        }
    }
    Write-Output "island sample dark=$dark / $sampled inside $x0,$y0-$x1,$y1"
}
if ($bmp) { $bmp.Dispose() }

if (-not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}
Stop-Winsur

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
if (-not $island) { $fail += "log missing island screen rect" }
elseif ($island.VisW -lt 40 -or $island.VisH -lt 16) {
    $fail += "island is off the screen (visible $($island.VisW)x$($island.VisH) at $($island.X),$($island.Y))"
}
if ($sampled -lt 20 -or $dark -lt ($sampled * 0.4)) { $fail += "island pixels not painted (dark $dark / $sampled)" }
if ($logText -notmatch "frontend=embedded") { $fail += "log missing frontend=embedded" }
if ($logText -notmatch "frontend: ready") { $fail += "log missing frontend ready (page script did not run)" }
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
