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
    } catch {
        # Unreadable/!JSON stdin is expected (e.g. invoked outside a hook). Fall through to
        # the 'default' fallback below rather than failing the hook.
        $sessionId = ''
    }
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

function Test-IsOurWorker {
    # Identity check that survives PID reuse. A PID counts as "our worker" only if a live
    # process with that id exists AND its command line references keepawake-worker.ps1 with
    # the matching -SessionId. Windows recycles PIDs, so trusting a bare PID could make us
    # kill an unrelated process that happened to inherit a dead worker's id; matching the
    # command line makes that effectively impossible.
    param(
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [Parameter(Mandatory = $true)][string]$SessionId
    )
    if ($ProcessId -le 0) { return $false }
    # CommandLine is reliably populated by CIM/WMI (unlike Process.CommandLine on 5.1) and
    # is readable for the current user's own processes without elevation.
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    if (-not $proc) { return $false }
    $cmd = [string]$proc.CommandLine
    if ([string]::IsNullOrEmpty($cmd)) { return $false }
    # SessionId is sanitized to [A-Za-z0-9._-], so it carries no -like wildcard characters.
    return ($cmd -like '*keepawake-worker.ps1*') -and ($cmd -like ("*-SessionId $SessionId*"))
}

function ConvertTo-BoolFlag {
    # Normalize a user-config string (e.g. from ${user_config.*} substitution) to a bool.
    # Empty/unrecognized falls back to $Default so the plugin still works if the value was
    # skipped or an older Claude substituted nothing.
    param([string]$Value, [bool]$Default = $false)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $Default }
    switch ($Value.Trim().ToLowerInvariant()) {
        'true'  { return $true }
        '1'     { return $true }
        'yes'   { return $true }
        'on'    { return $true }
        'false' { return $false }
        '0'     { return $false }
        'no'    { return $false }
        'off'   { return $false }
        default { return $Default }
    }
}

function ConvertTo-LifetimeHours {
    # Normalize a user-config string to a backstop duration in hours, clamped to [Min, Max].
    # Empty/non-numeric falls back to $Default.
    param([string]$Value, [double]$Default = 8, [double]$Min = 1, [double]$Max = 24)
    $n = 0.0
    if (-not [double]::TryParse($Value, [ref]$n)) { return $Default }
    if ($n -lt $Min) { return $Min }
    if ($n -gt $Max) { return $Max }
    return $n
}

function Get-PluginOption {
    # Read a plugin userConfig value from the environment. Claude Code exports each userConfig
    # value to plugin subprocesses as CLAUDE_PLUGIN_OPTION_<KEY>. We read it here instead of
    # using ${user_config.KEY} substitution in the hook command on purpose: that substitution
    # HARD-FAILS the whole hook if the option has never been stored (e.g. the user skipped the
    # config dialog), whereas a missing env var simply leaves us to apply a default.
    #
    # The exact casing of <KEY> is not contractually guaranteed, so check both the uppercased
    # and verbatim forms. Returns '' when absent; callers apply their own default.
    param([Parameter(Mandatory = $true)][string]$Name)
    foreach ($candidate in @("CLAUDE_PLUGIN_OPTION_$($Name.ToUpperInvariant())", "CLAUDE_PLUGIN_OPTION_$Name")) {
        $v = [Environment]::GetEnvironmentVariable($candidate)
        if (-not [string]::IsNullOrWhiteSpace($v)) { return $v }
    }
    return ''
}
