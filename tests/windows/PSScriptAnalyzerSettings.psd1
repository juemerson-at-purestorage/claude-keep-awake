@{
    # Run the full default PSScriptAnalyzer rule set. The remaining PowerShell is just the
    # keep-awake holder body and the status probe (both delivered via -EncodedCommand by the
    # Node dispatcher); no project-specific exclusions are needed.
    IncludeDefaultRules = $true
}
