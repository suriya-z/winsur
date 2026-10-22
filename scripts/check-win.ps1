Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Win {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc proc, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder sb, int count);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$pids = @(Get-Process -Name winsur,Winsur -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
Write-Output "Winsur PIDs: $($pids -join ', ')"
if ($pids.Count -eq 0) { exit 0 }
[Win]::EnumWindows([Win+EnumWindowsProc]{
    param($hwnd, $lparam)
    [uint32]$procId = 0
    [Win]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
    if ($pids -contains $procId) {
        $sb = New-Object System.Text.StringBuilder 256
        [Win]::GetWindowText($hwnd, $sb, 256) | Out-Null
        $vis = [Win]::IsWindowVisible($hwnd)
        $r = New-Object Win+RECT
        [Win]::GetWindowRect($hwnd, [ref]$r) | Out-Null
        Write-Output "Hwnd: $hwnd | PID: $procId | Visible: $vis | Title: '$($sb.ToString())' | Rect: $($r.Left),$($r.Top) -> $($r.Right),$($r.Bottom)"
    }
    return [bool]$true
}, [IntPtr]::Zero) | Out-Null

