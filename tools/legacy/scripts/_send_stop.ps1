# _send_stop.ps1 — 向正在运行的 BDS 控制台写入 stop（优雅停服），结果写 _stop_result.txt
# 用法：pwsh -File work\_send_stop.ps1 -Pid 19396
param([int]$TargetPid = 0, [string]$Text = "stop`r")

$outFile = Join-Path $PSScriptRoot '_stop_result.txt'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class ConIO {
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint dwProcessId);
    [StructLayout(LayoutKind.Explicit, CharSet=CharSet.Unicode)]
    public struct KEY_EVENT_RECORD {
        [FieldOffset(0)] public int bKeyDown;
        [FieldOffset(4)] public ushort wRepeatCount;
        [FieldOffset(6)] public ushort wVirtualKeyCode;
        [FieldOffset(8)] public ushort wVirtualScanCode;
        [FieldOffset(10)] public char UnicodeChar;
        [FieldOffset(12)] public uint dwControlKeyState;
    }
    [StructLayout(LayoutKind.Explicit)]
    public struct INPUT_RECORD {
        [FieldOffset(0)] public ushort EventType;
        [FieldOffset(4)] public KEY_EVENT_RECORD KeyEvent;
    }
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern IntPtr GetStdHandle(int nStdHandle);
    [DllImport("kernel32.dll", EntryPoint="WriteConsoleInputW", SetLastError=true)]
    public static extern bool WriteConsoleInputW(IntPtr hConsoleInput, INPUT_RECORD[] lpBuffer, uint nLength, out uint written);

    public static string Send(string text, uint pid) {
        FreeConsole();
        if (!AttachConsole(pid)) return "attach-failed:" + Marshal.GetLastWin32Error();
        IntPtr h = GetStdHandle(-10);
        var list = new List<INPUT_RECORD>();
        foreach (char c in text) {
            var down = new INPUT_RECORD();
            down.EventType = 1;
            down.KeyEvent.bKeyDown = 1;
            down.KeyEvent.wRepeatCount = 1;
            down.KeyEvent.UnicodeChar = c;
            if (c == '\r') down.KeyEvent.wVirtualKeyCode = 13;
            list.Add(down);
            var up = down;
            up.KeyEvent.bKeyDown = 0;
            list.Add(up);
        }
        uint written;
        bool ok = WriteConsoleInputW(h, list.ToArray(), (uint)list.Count, out written);
        int err = Marshal.GetLastWin32Error();
        FreeConsole();
        return ok ? ("ok:" + written) : ("write-failed:" + err);
    }
}
'@

try {
    $r = [ConIO]::Send($Text, [uint32]$TargetPid)
} catch {
    $r = "EX:" + $_.Exception.Message
}
[IO.File]::WriteAllText($outFile, $r)
