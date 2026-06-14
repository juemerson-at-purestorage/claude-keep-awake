# Keep-awake holder body (the single source of truth for the PowerSetRequest holder).
#
# This file is NOT run directly. The Node dispatcher (scripts/dispatch.mjs) prepends a small
# prelude defining $Reason, $KeepDisplay, and $MaxHours, then runs the combined script via
#   powershell.exe -NoProfile -EncodedCommand <base64-utf16le>
# on BOTH native Windows and WSL2 (the latter over Windows interop). Using -EncodedCommand
# means one source with no .ps1 file-path / wslpath / UNC translation to get wrong.
#
# It holds a Windows PowerSetRequest(PowerRequestSystemRequired) for as long as it runs, which
# blocks automatic system sleep. With $KeepDisplay it additionally holds
# PowerRequestDisplayRequired so the monitor stays lit. The OS clears both requests
# automatically when this process exits, so the dispatcher releases the block simply by
# terminating this process (Stop/SessionEnd hook). As a backstop against a session that
# crashed without firing those hooks, the holder also self-exits after $MaxHours.
#
# Note: neither request prevents the lock screen (driven by the screensaver/inactivity policy
# off the input-idle timer, which power requests do not touch) -- only sleep/display.

$ErrorActionPreference = 'Stop'

# --- prelude contract (defined by the dispatcher; defaults here only for direct testing) ---
if (-not (Test-Path variable:Reason))      { $Reason = 'Claude Code keep-awake' }
if (-not (Test-Path variable:KeepDisplay)) { $KeepDisplay = $false }
if (-not (Test-Path variable:MaxHours))    { $MaxHours = 8 }

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
[void][SleepBlock]::Block([string]$Reason, [bool]$KeepDisplay)

# Absolute backstop. A forceful terminate by the dispatcher (unblock) interrupts this sleep
# immediately; this timer only matters if the dispatcher never gets to release us. Clamp to a
# whole number of seconds, minimum 1.
$seconds = [int][math]::Max(1, [math]::Round([double]$MaxHours * 3600))
Start-Sleep -Seconds $seconds
# Process exit releases the PowerSetRequest automatically.
