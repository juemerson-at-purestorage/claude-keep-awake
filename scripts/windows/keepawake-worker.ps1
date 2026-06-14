# Keep-awake worker (detached background process, one per session).
#
# Holds a Windows PowerSetRequest(PowerRequestSystemRequired) for as long as it runs,
# which blocks automatic system sleep. With -KeepDisplayOn it additionally holds
# PowerRequestDisplayRequired so the monitor stays lit instead of dimming. The OS clears
# both requests automatically when this process exits, so stopping the worker is all that
# is needed to release the block.
#
# Note: neither request prevents the lock screen (driven by the screensaver/inactivity
# policy off the input-idle timer, which power requests do not touch) -- only sleep/display.
#
# Lifecycle:
#   - write <session>.lock containing our PID + start time,
#   - loop until either the lock file disappears (unblock-sleep.ps1's graceful signal)
#     or the configured max lifetime elapses (backstop against a crashed session).
param(
    [Parameter(Mandatory = $true)][string]$SessionId,
    # Config values arrive as strings (from ${user_config.*} substitution via block-sleep);
    # _common's converters normalize them and fall back to defaults if empty/invalid.
    [string]$KeepDisplayOn    = 'false',
    [string]$MaxLifetimeHours = '8'
)

. "$PSScriptRoot\_common.ps1"
if (-not (Test-IsWindows)) { exit 0 }

$keepDisplay = ConvertTo-BoolFlag $KeepDisplayOn -Default $false
$maxHours    = ConvertTo-LifetimeHours $MaxLifetimeHours -Default 8 -Min 1 -Max 24

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

    // POWER_REQUEST_TYPE: 0 = PowerRequestDisplayRequired, 1 = PowerRequestSystemRequired.
    // Multiple request types can be asserted on a single request handle; each is cleared
    // independently when the process exits.
    public static IntPtr Block(string reason, bool keepDisplay) {
        var ctx = new REASON_CONTEXT {
            Version = 0,            // POWER_REQUEST_CONTEXT_VERSION
            Flags   = 1,            // POWER_REQUEST_CONTEXT_SIMPLE_STRING
            SimpleReasonString = reason
        };
        IntPtr h = PowerCreateRequest(ref ctx);
        if (h == IntPtr.Zero || h == new IntPtr(-1)) {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        if (!PowerSetRequest(h, 1)) {            // PowerRequestSystemRequired (always)
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        if (keepDisplay) {
            if (!PowerSetRequest(h, 0)) {        // PowerRequestDisplayRequired (optional)
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            }
        }
        return h;
    }
}
'@
Add-Type -TypeDefinition $signature -Language CSharp
$reason = "Claude Code keep-awake (session $SessionId)"
if ($keepDisplay) { $reason += " [display]" }
[void][SleepBlock]::Block($reason, $keepDisplay)

$lockPath = Get-LockPath $SessionId
$start    = Get-Date
# Line 1 = PID, line 2 = ISO 8601 start time.
Set-Content -LiteralPath $lockPath -Value @("$PID", $start.ToString('o')) -Encoding ASCII

# Absolute backstop ($maxHours, set from config above). The lock is only refreshed at
# prompt-submit time and a single turn can run many minutes with no new prompt, so we do
# NOT use a short inactivity timeout (it would wrongly release mid-turn). This ceiling only
# guards against a session that crashed without firing Stop/SessionEnd; no real turn
# approaches it.
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
