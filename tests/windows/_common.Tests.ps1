# Pester 5 unit tests for the pure/deterministic helpers in scripts/windows/_common.ps1.
#
# These cover the option-parsing logic (the v1.1.0 bug class: a skipped/garbled config value
# must degrade to a safe default, never fail) plus the PID-reuse guards' cheap negative paths.
# Process-spawning lifecycle behavior (block -> worker -> unblock) is intentionally NOT here;
# it is an integration concern. Run with:  Invoke-Pester -Path tests/windows

BeforeAll {
    . "$PSScriptRoot\..\..\scripts\windows\_common.ps1"
}

Describe 'ConvertTo-BoolFlag' {
    It 'treats <Value> as true' -ForEach @(
        @{ Value = 'true' }, @{ Value = 'True' }, @{ Value = '1' },
        @{ Value = 'yes'  }, @{ Value = 'on'   }, @{ Value = ' ON ' }
    ) {
        ConvertTo-BoolFlag $Value | Should -BeTrue
    }

    It 'treats <Value> as false' -ForEach @(
        @{ Value = 'false' }, @{ Value = 'FALSE' }, @{ Value = '0' },
        @{ Value = 'no'    }, @{ Value = 'off'   }
    ) {
        ConvertTo-BoolFlag $Value | Should -BeFalse
    }

    It 'falls back to the default when blank or unrecognized' {
        ConvertTo-BoolFlag ''      -Default $true  | Should -BeTrue
        ConvertTo-BoolFlag '   '   -Default $true  | Should -BeTrue
        ConvertTo-BoolFlag $null   -Default $true  | Should -BeTrue
        ConvertTo-BoolFlag 'maybe' -Default $false | Should -BeFalse
    }

    It 'defaults to false when no default is supplied' {
        ConvertTo-BoolFlag '' | Should -BeFalse
    }
}

Describe 'ConvertTo-LifetimeHours' {
    It 'returns a valid in-range number as-is' {
        ConvertTo-LifetimeHours '3'   | Should -Be 3
        ConvertTo-LifetimeHours '8'   | Should -Be 8
        ConvertTo-LifetimeHours '1.5' | Should -Be 1.5
    }

    It 'clamps above the max (default 24)' {
        ConvertTo-LifetimeHours '99' | Should -Be 24
    }

    It 'clamps below the min (default 1)' {
        ConvertTo-LifetimeHours '0'    | Should -Be 1
        ConvertTo-LifetimeHours '-5'   | Should -Be 1
    }

    It 'honors custom Min/Max bounds' {
        ConvertTo-LifetimeHours '100' -Max 12 | Should -Be 12
        ConvertTo-LifetimeHours '1'   -Min 2  | Should -Be 2
    }

    It 'falls back to the default on non-numeric or empty input' {
        ConvertTo-LifetimeHours 'abc' | Should -Be 8
        ConvertTo-LifetimeHours ''    | Should -Be 8
        ConvertTo-LifetimeHours 'abc' -Default 5 | Should -Be 5
    }
}

Describe 'Get-PluginOption' {
    BeforeEach {
        $env:CLAUDE_PLUGIN_OPTION_KEEP_DISPLAY_ON = $null
        $env:CLAUDE_PLUGIN_OPTION_keep_display_on = $null
    }
    AfterEach {
        $env:CLAUDE_PLUGIN_OPTION_KEEP_DISPLAY_ON = $null
        $env:CLAUDE_PLUGIN_OPTION_keep_display_on = $null
    }

    It 'reads the uppercased CLAUDE_PLUGIN_OPTION_<KEY> form' {
        $env:CLAUDE_PLUGIN_OPTION_KEEP_DISPLAY_ON = 'true'
        Get-PluginOption 'keep_display_on' | Should -Be 'true'
    }

    It 'reads the verbatim-cased form as a fallback' {
        $env:CLAUDE_PLUGIN_OPTION_keep_display_on = 'on'
        Get-PluginOption 'keep_display_on' | Should -Be 'on'
    }

    It 'returns empty string when the option is unset (never throws)' {
        Get-PluginOption 'keep_display_on' | Should -Be ''
    }

    It 'treats a whitespace-only value as unset' {
        $env:CLAUDE_PLUGIN_OPTION_KEEP_DISPLAY_ON = '   '
        Get-PluginOption 'keep_display_on' | Should -Be ''
    }
}

Describe 'Get-LockPath' {
    It 'builds <session>.lock under the lock directory' {
        $p = Get-LockPath 'abc-123'
        $p | Should -BeLike '*claude-keep-awake*abc-123.lock'
    }

    It 'is stable for the same session id' {
        (Get-LockPath 'same') | Should -Be (Get-LockPath 'same')
    }
}

Describe 'Test-IsOurWorker' {
    It 'returns false for a non-positive PID without touching the system' {
        Test-IsOurWorker -ProcessId 0  -SessionId 'x' | Should -BeFalse
        Test-IsOurWorker -ProcessId -1 -SessionId 'x' | Should -BeFalse
    }

    It 'returns false for a PID that is not our worker' {
        # The current pwsh test host is a real, live process but is not a keepawake worker,
        # so the command-line identity check must reject it.
        Test-IsOurWorker -ProcessId $PID -SessionId 'x' | Should -BeFalse
    }
}

Describe 'Test-IsWindows' {
    It 'returns a boolean' {
        Test-IsWindows | Should -BeOfType [bool]
    }
}
