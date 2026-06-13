# Keep-awake worker (detached background process, one per session).
#
# Holds a Windows PowerSetRequest(PowerRequestSystemRequired) for as long as it runs,
# which blocks automatic system sleep while still letting the monitor dim. The OS clears
# the request automatically when this process exits, so stopping the worker is all that
# is needed to release the block.
#
# Lifecycle:
#   - write <session>.lock containing our PID + start time,
#   - loop until either the lock file disappears (unblock-sleep.ps1's graceful signal)
#     or an absolute max lifetime elapses (backstop against a crashed session).
param([Parameter(Mandatory = $true)][string]$SessionId)

. "$PSScriptRoot\_common.ps1"
if (-not (Test-IsWindows)) { exit 0 }

$signature = @'
using System;
using System.Runtime.InteropServices;

public static class SleepBlock {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct REASON_CONTEXT {
        public uint Version;
        public uint Flags;
        [MarshalAs(UnmanagedType.LPWStr)] public string SimpleReasonString;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr PowerCreateRequest(ref REASON_CONTEXT Context);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool PowerSetRequest(IntPtr PowerRequest, int RequestType);

    // RequestType 1 = PowerRequestSystemRequired
    public static IntPtr Block(string reason) {
        var ctx = new REASON_CONTEXT {
            Version = 0,            // POWER_REQUEST_CONTEXT_VERSION
            Flags   = 1,            // POWER_REQUEST_CONTEXT_SIMPLE_STRING
            SimpleReasonString = reason
        };
        IntPtr h = PowerCreateRequest(ref ctx);
        if (h == IntPtr.Zero || h == new IntPtr(-1)) {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        if (!PowerSetRequest(h, 1)) {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        return h;
    }
}
'@
Add-Type -TypeDefinition $signature -Language CSharp
[void][SleepBlock]::Block("Claude Code keep-awake (session $SessionId)")

$lockPath = Get-LockPath $SessionId
$start    = Get-Date
# Line 1 = PID, line 2 = ISO 8601 start time.
Set-Content -LiteralPath $lockPath -Value @("$PID", $start.ToString('o')) -Encoding ASCII

# Absolute backstop. The lock is only refreshed at prompt-submit time and a single turn
# can run many minutes with no new prompt, so we do NOT use a short inactivity timeout
# (it would wrongly release mid-turn). This ceiling only guards against a session that
# crashed without firing Stop/SessionEnd; no real turn approaches it.
$maxHours = 8

try {
    while ($true) {
        Start-Sleep -Seconds 10
        if (-not (Test-Path -LiteralPath $lockPath)) { break }           # unblock removed it
        if (((Get-Date) - $start).TotalHours -ge $maxHours) { break }    # backstop
    }
}
finally {
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}
# Process exit releases the PowerSetRequest automatically.
