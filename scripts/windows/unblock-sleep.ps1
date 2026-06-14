# Stop / SessionEnd hook: stop THIS session's keep-awake worker.
#
# Looks up the lock for this session's id, kills the worker PID it records, and removes
# the lock. Because the lock is keyed by session id, one Claude window finishing never
# touches another window's worker (per-window isolation is structural, not string-based).

. "$PSScriptRoot\_common.ps1"
if (-not (Test-IsWindows)) { exit 0 }

$sessionId = Get-SessionId
$lockPath  = Get-LockPath $sessionId

if (Test-Path -LiteralPath $lockPath) {
    $pidLine   = Get-Content -LiteralPath $lockPath -ErrorAction SilentlyContinue | Select-Object -First 1
    $workerPid = 0
    # Only kill if the PID is verifiably OUR worker for THIS session -- guards against a
    # reused PID that now belongs to an unrelated process. Either way the lock is removed.
    if ([int]::TryParse($pidLine, [ref]$workerPid) -and (Test-IsOurWorker -ProcessId $workerPid -SessionId $sessionId)) {
        Stop-Process -Id $workerPid -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}
exit 0
