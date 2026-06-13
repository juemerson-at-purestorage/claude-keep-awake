# Shared helpers for the claude-keep-awake Windows scripts.
# Dot-source from a sibling script:  . "$PSScriptRoot\_common.ps1"
#
# These scripts run under Windows PowerShell 5.1 (launched by the hook's outer pwsh),
# so everything here must be 5.1-compatible.

function Test-IsWindows {
    # $IsWindows is an automatic variable only in PowerShell 6+. Under Windows
    # PowerShell 5.1 it is undefined ($null), and 5.1 only exists on Windows.
    if ($null -ne $IsWindows) { return [bool]$IsWindows }
    return $true
}

function Get-SessionId {
    # Read the hook JSON from stdin and return its session_id, sanitized for use as a
    # filename. Falls back to 'default' if stdin is empty or unparseable, so the block
    # and unblock scripts still pair up (degrading to global, non-isolated behavior).
    $sessionId = ''
    try {
        $raw = [Console]::In.ReadToEnd()
        if ($raw) { $sessionId = [string]((ConvertFrom-Json $raw).session_id) }
    } catch { }
    if ([string]::IsNullOrWhiteSpace($sessionId)) { $sessionId = 'default' }
    # session_id is normally a UUID, but sanitize anyway so it is always a safe filename.
    return ($sessionId -replace '[^A-Za-z0-9._-]', '_')
}

function Get-LockDir {
    # Per-user temp subfolder. %TEMP% always exists; we create only the subfolder.
    $dir = Join-Path $env:TEMP 'claude-keep-awake'
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    return $dir
}

function Get-LockPath {
    param([Parameter(Mandatory = $true)][string]$SessionId)
    return (Join-Path (Get-LockDir) ("{0}.lock" -f $SessionId))
}

function Test-ProcessAlive {
    param([Parameter(Mandatory = $true)][int]$ProcessId)
    return [bool](Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}
