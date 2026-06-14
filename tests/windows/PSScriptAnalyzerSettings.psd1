@{
    # Run the full default PSScriptAnalyzer rule set...
    IncludeDefaultRules = $true

    # ...minus a couple that don't fit this project:
    ExcludeRules = @(
        # 'Hours' in ConvertTo-LifetimeHours is a genuine count, not an accidental plural.
        # Renaming to a singular noun would read worse and break the call site in
        # keepawake-worker.ps1, so we opt out of this style rule rather than contort the name.
        'PSUseSingularNouns'
    )
}
