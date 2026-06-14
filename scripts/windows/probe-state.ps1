# Power-state probe for /keep-awake-status (self-contained; no dot-sourcing).
#
# The Node dispatcher reads this file, base64/-EncodedCommand encodes it, and runs it via
# powershell.exe -- directly on native Windows, or over interop on WSL2 (where it reports the
# HOST's state). It prints two machine-readable marker lines that dispatch.mjs parses:
#   SYSTEM_REQUIRED=True|False
#   DISPLAY_REQUIRED=True|False
#
# Reads the live system execution state via CallNtPowerInformation(SystemExecutionState), which
# (unlike `powercfg /requests`) needs no elevation. Bit 0 (ES_SYSTEM_REQUIRED, 0x1) set means
# automatic system sleep is currently blocked; bit 1 (ES_DISPLAY_REQUIRED, 0x2) means the
# display is being kept on.

$ErrorActionPreference = 'Stop'

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

$state = [PwrCheck]::Read()
[Console]::Out.WriteLine("SYSTEM_REQUIRED=" + [bool](($state -band 0x1) -ne 0))
[Console]::Out.WriteLine("DISPLAY_REQUIRED=" + [bool](($state -band 0x2) -ne 0))
