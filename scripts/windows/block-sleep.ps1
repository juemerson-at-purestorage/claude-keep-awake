# UserPromptSubmit hook entry point.
#
# Ensures exactly one keep-awake worker is running for this Claude session:
#   1. reap stale locks (whose recorded worker PID is gone),
#   2. if this session already has a live worker, just refresh its lock and exit,
#   3. otherwise spawn a detached worker tagged with this session id.
#
# This script spawns-and-exits in well under a second, so the hook is synchronous
# (no "async") -- synchronous hooks reliably receive the stdin JSON we need.

. "$PSScriptRoot\_common.ps1"
if (-not (Test-IsWindows)) { exit 0 }

# Read user options from the environment Claude Code exports for plugin subprocesses
# (CLAUDE_PLUGIN_OPTION_*), forwarded verbatim to the worker which normalizes them. We do NOT
# use ${user_config.*} substitution in the hook command: that hard-fails the hook if an option
# was never stored, whereas a missing env var just falls back to the worker's default.
$keepDisplayOn    = Get-PluginOption 'keep_display_on'
$maxLifetimeHours = Get-PluginOption 'max_lifetime_hours'

$sessionId = Get-SessionId
$lockDir   = Get-LockDir

# 1) Reap stale locks: drop any lock whose recorded PID is no longer OUR worker (dead, or a
#    reused PID now belonging to an unrelated process). The lock's session id is its filename.
Get-ChildItem -LiteralPath $lockDir -Filter '*.lock' -ErrorAction SilentlyContinue | ForEach-Object {
    $pidLine = Get-Content -LiteralPath $_.FullName -ErrorAction SilentlyContinue | Select-Object -First 1
    $oldPid  = 0
    $lockSession = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
    if ([int]::TryParse($pidLine, [ref]$oldPid)) {
        if (-not (Test-IsOurWorker -ProcessId $oldPid -SessionId $lockSession)) {
            Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
        }
    }
    else {
        # Garbled lock with no parseable PID -- discard it.
        Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
    }
}

# 2) Idempotent: if this session already has a live worker, refresh the lock and exit.
$lockPath = Get-LockPath $sessionId
if (Test-Path -LiteralPath $lockPath) {
    $pidLine = Get-Content -LiteralPath $lockPath -ErrorAction SilentlyContinue | Select-Object -First 1
    $curPid = 0
    if ([int]::TryParse($pidLine, [ref]$curPid) -and (Test-IsOurWorker -ProcessId $curPid -SessionId $sessionId)) {
        (Get-Item -LiteralPath $lockPath).LastWriteTime = Get-Date
        exit 0
    }
    # Stale/garbled -> remove and fall through to spawn a fresh worker.
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}

# 3) Spawn the detached worker. Build a single quoted argument string so the space in
# the resolved plugin path (e.g. "Justin Emerson") survives -- Start-Process does not
# quote array elements, so a bare -File path with a space would get split. Config values
# are quoted too so an empty substitution can't shift the argument positions.
$worker  = Join-Path $PSScriptRoot 'keepawake-worker.ps1'
$argLine = '-NoProfile -WindowStyle Hidden -File "{0}" -SessionId {1} -KeepDisplayOn "{2}" -MaxLifetimeHours "{3}"' -f `
    $worker, $sessionId, $keepDisplayOn, $maxLifetimeHours
Start-Process powershell.exe -ArgumentList $argLine -WindowStyle Hidden
exit 0
