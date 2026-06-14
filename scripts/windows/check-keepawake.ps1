# Diagnostic (no admin required): is system sleep currently blocked, and which workers
# are running?
#
# Reads the live system execution state via CallNtPowerInformation(SystemExecutionState).
# This is more reliable than `powercfg /requests`, which needs elevation and does not
# consistently surface PowerSetRequest requests. Bit 0 (ES_SYSTEM_REQUIRED, 0x1) set
# means automatic system sleep is currently blocked.

. "$PSScriptRoot\_common.ps1"
if (-not (Test-IsWindows)) {
    "Not running on Windows - keep-awake is a no-op on this platform."
    exit 0
}

$sig = @'
using System;
using System.Runtime.InteropServices;
public static class PwrCheck {
    [DllImport("powrprof.dll")]
    public static extern uint CallNtPowerInformation(int lvl, IntPtr inB, uint inS, out uint outB, uint outS);
    public static uint Read() { uint s = 0; CallNtPowerInformation(16, IntPtr.Zero, 0, out s, 4); return s; } // 16 = SystemExecutionState
}
'@
Add-Type -TypeDefinition $sig -Language CSharp

$state   = [PwrCheck]::Read()
$blocked = ($state -band 0x1) -ne 0   # ES_SYSTEM_REQUIRED
$display = ($state -band 0x2) -ne 0   # ES_DISPLAY_REQUIRED

"SystemExecutionState : 0x{0:X8}" -f $state
"System sleep blocked : {0}" -f $blocked
"Display kept on      : {0}" -f $display

$lockDir = Get-LockDir
$locks   = Get-ChildItem -LiteralPath $lockDir -Filter '*.lock' -ErrorAction SilentlyContinue
if ($locks) {
    "active keep-awake workers:"
    foreach ($l in $locks) {
        $lines   = @(Get-Content -LiteralPath $l.FullName -ErrorAction SilentlyContinue)
        $wPid    = if ($lines.Count -ge 1) { $lines[0] } else { '(unknown)' }
        $session = [System.IO.Path]::GetFileNameWithoutExtension($l.Name)
        $p       = 0
        # "ours" = a live process whose command line is this session's worker (PID-reuse safe).
        $ours    = if ([int]::TryParse($wPid, [ref]$p)) { Test-IsOurWorker -ProcessId $p -SessionId $session } else { $false }
        "  session {0}  PID {1}  ours {2}" -f $session, $wPid, $ours
    }
}
else {
    "active keep-awake workers: (none running)"
}
