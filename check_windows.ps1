Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class User32All {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    public struct RECT { public int Left, Top, Right, Bottom; }
    public static void CheckPids(uint[] pids) {
        EnumWindows((hWnd, lParam) => {
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            foreach (var p in pids) {
                if (p == pid) {
                    RECT r;
                    GetWindowRect(hWnd, out r);
                    bool vis = IsWindowVisible(hWnd);
                    StringBuilder sb = new StringBuilder(256);
                    GetWindowText(hWnd, sb, 256);
                    Console.WriteLine("HWND=" + hWnd + " PID=" + pid + " Vis=" + vis + " Rect=[" + r.Left + "," + r.Top + "," + r.Right + "," + r.Bottom + "] Title='" + sb.ToString() + "'");
                }
            }
            return true;
        }, IntPtr.Zero);
    }
}
'@
$pids = @(Get-Process -Name "*winsur*","*electron*" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
if ($pids.Count -gt 0) {
    [User32All]::CheckPids([uint32[]]$pids)
} else {
    Write-Output "No Winsur/Electron processes running."
}
