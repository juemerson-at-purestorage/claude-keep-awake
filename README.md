# keep-awake

[![CI](https://github.com/juemerson-at-purestorage/claude-keep-awake/actions/workflows/ci.yml/badge.svg)](https://github.com/juemerson-at-purestorage/claude-keep-awake/actions/workflows/ci.yml)

A [Claude Code](https://code.claude.com) plugin that keeps your **computer** from going to
sleep while Claude is working, and lets it sleep normally again as soon as the turn ends.

If you kick off a long task and walk away, your machine no longer dozes off mid-run. It is
scoped per Claude session, so running several Claude windows at once is safe: one window
finishing never lets another window's machine sleep.

> **Platform support:** Windows is implemented today. macOS and Linux are not implemented
> yet — there the plugin detects the OS and exits cleanly (a harmless no-op), so it is safe
> to install anywhere. The layout and hook contract are structured so those platforms can
> drop in — contributions welcome; see [Contributing](#contributing--other-platforms).

## How it works on Windows

- On **`UserPromptSubmit`**, the plugin starts a small detached background *worker* tagged
  with your `session_id`. The worker holds a Windows
  [`PowerSetRequest`](https://learn.microsoft.com/windows/win32/api/winnt/ne-winnt-power_request_type)
  of type `PowerRequestSystemRequired`, which blocks automatic system sleep while still
  letting the monitor dim. (With [`keep_display_on`](#configuration) it also holds
  `PowerRequestDisplayRequired`, so the monitor stays lit too.) Windows clears the request
  automatically when the worker exits.
- On **`Stop`** and **`SessionEnd`**, the plugin stops that session's worker.
- Each worker records its PID in a per-session lock file under
  `%TEMP%\claude-keep-awake\<session_id>.lock`. Stopping is done by reading the lock — no
  fragile process-command-line matching.

### Robustness

- **Idempotent:** re-prompting in a session that already has a worker just refreshes the
  lock; it never stacks duplicate workers.
- **Stale-lock reaping:** each prompt sweeps lock files whose recorded process is gone.
- **Max-lifetime backstop:** if a session crashes without firing `Stop`/`SessionEnd`, its
  worker self-releases after a hard ceiling (8 hours) instead of surviving until reboot.

### When your machine sleeps vs. stays awake

The block is held only while a turn is actively running:

- **Claude is working** (thinking, running commands, including long-running commands and
  subagents) — the system stays awake.
- **The turn finishes and Claude is waiting for your next prompt** — the worker is released
  (on `Stop`), so your machine sleeps normally. Nothing to do; this is automatic, so walking
  away after Claude is done does *not* keep the machine up.
- **Claude is paused mid-turn waiting for you to approve a permission prompt** — the machine
  **stays awake** while the prompt is pending. This is deliberate: Claude Code fires no hook
  at the instant you approve, and a pending permission prompt is indistinguishable from a
  long-running command in the hook stream, so releasing during the wait could let the machine
  sleep *in the middle of the command you just approved*. Staying awake is the safe choice. If
  you've stepped away and don't intend to approve, cancel the turn (Esc) — that returns to the
  waiting-for-prompt state above, and the machine can sleep.

## Install

```
/plugin marketplace add github:juemerson-at-purestorage/claude-keep-awake
/plugin install keep-awake@claude-keep-awake
```

> The repository is both the plugin and its own marketplace, so a single
> `marketplace add` is enough.

Restart Claude Code (or reload) so the hooks register. Nothing else to configure — there
are no paths to set up.

## Configuration

The plugin works out of the box; these options are optional. Claude Code prompts for them
when you enable the plugin and stores them in your `settings.json` under `pluginConfigs`.

| Option | Default | What it does |
|--------|---------|--------------|
| **Keep the display on too** (`keep_display_on`) | off | Also keeps the monitor lit while Claude works, not just the system awake. **Does not prevent the lock screen** (see below). |
| **Max keep-awake hours** (`max_lifetime_hours`) | `8` | Safety backstop: a worker self-releases after this many hours (range 1–24) if a session ever crashes without cleaning up. No normal turn comes close. |

> **`keep_display_on` keeps the screen powered, not unlocked.** It prevents the monitor from
> dimming/turning off on the power-idle timer, but it does **not** stop your screensaver or
> your organization's inactivity policy from locking the machine — those run off the
> *input*-idle timer, which power requests don't touch. So expect: system never sleeps,
> screen stays on, but the machine can still lock.

**Changing options later:** Claude Code captures these at *enable* time and doesn't yet
offer an in-place editor. To change them, either re-enable the plugin via `/plugin`, or edit
the `pluginConfigs["keep-awake@claude-keep-awake"].options` block in your `settings.json`
directly.

## Verify it works

Run the bundled diagnostic (no admin needed):

```
/keep-awake-status
```

or directly:

```powershell
powershell.exe -NoProfile -File "<plugin-root>\scripts\windows\check-keepawake.ps1"
```

It prints the live `SystemExecutionState`, a `System sleep blocked : True/False` verdict,
and any active workers. The decisive test is differential — submit a prompt and you should
see `0x...1` / `True` while Claude works, returning to `0x...0` / `False` after the turn
ends.

## Limitations

- macOS and Linux are not implemented yet (clean no-op there) — contributions welcome.
- A worker orphaned by a hard crash persists until the max-lifetime backstop fires (default
  8 hours, configurable; the next prompt in any session also reaps it once its process is
  actually gone).
- Never prevents the **lock screen** — only system sleep and (optionally) display-off. See
  [Configuration](#configuration).
- By default blocks *system* sleep only and lets the display turn off; set `keep_display_on`
  to keep the monitor lit as well.

## Contributing — other platforms

The hook **contract** is platform-agnostic:

- **In:** the hook JSON arrives on stdin and includes a stable `session_id`.
- **Out:** on `UserPromptSubmit`, start a session-scoped keep-awake; on `Stop`/`SessionEnd`,
  stop the one for that `session_id`.

A macOS implementation would wrap `caffeinate`; Linux would wrap `systemd-inhibit`. Drop
them under `scripts/macos/` and `scripts/linux/` and route to the right one from
`hooks/hooks.json` (e.g. via a small `pwsh` dispatcher, since PowerShell Core runs on all
three platforms). The Windows scripts in `scripts/windows/` are the reference.

The two `userConfig` options are deliberately platform-neutral and map cleanly, so a new
backend should honor the same keys:

| Concept | Windows | macOS | Linux |
|---------|---------|-------|-------|
| Block system sleep (always) | `PowerRequestSystemRequired` | `caffeinate -i` | `systemd-inhibit --what=sleep` |
| `keep_display_on` | `PowerRequestDisplayRequired` | `caffeinate -d` | `systemd-inhibit --what=idle` |
| `max_lifetime_hours` backstop | worker loop | worker loop (or `caffeinate -t`) | worker loop |

Notes for those backends: `systemd-inhibit` has **no** timeout flag, so the worker-loop
backstop is required for `max_lifetime_hours` parity on Linux; the Linux `idle` inhibitor is
honored only by desktop environments that respect `logind` (GNOME/KDE), so `keep_display_on`
there is best-effort and may need an `xset s off` / `xdg-screensaver` fallback; and the
Linux backend assumes `systemd-logind` (non-systemd setups need a different mechanism).
None of these tools prevent the lock screen on any platform.

## Development

The repo keeps each platform's implementation and its tests in their own subtree, so adding
a new OS never disturbs an existing one:

```
scripts/<os>/   implementation for that platform   (scripts/windows today)
tests/<os>/     that platform's tests + lint config (tests/windows today)
hooks/          platform-agnostic hook wiring
.github/workflows/ci.yml   CI: neutral manifest checks + a per-OS lane
```

CI runs on every push and pull request ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

- **Validate manifests** (platform-neutral): every `*.json` parses, and `plugin.json` /
  `marketplace.json` agree on the plugin name and version.
- **Windows scripts**: [PSScriptAnalyzer](https://github.com/PowerShell/PSScriptAnalyzer)
  lint over `scripts/` plus [Pester](https://pester.dev) unit tests over `tests/windows/`.

Run the Windows checks locally (Windows PowerShell or PowerShell 7+):

```powershell
Install-Module Pester, PSScriptAnalyzer -Scope CurrentUser   # once

# Lint
Invoke-ScriptAnalyzer -Path scripts -Recurse -Settings tests/windows/PSScriptAnalyzerSettings.psd1

# Unit tests
Invoke-Pester -Path tests/windows -Output Detailed
```

The Pester suite covers the deterministic helpers in `_common.ps1` — option parsing
(`ConvertTo-BoolFlag`, `ConvertTo-LifetimeHours`, `Get-PluginOption`) and the PID-reuse
guard's negative paths. The process-spawning lifecycle is exercised by the manual
verification flow under [Verify it works](#verify-it-works). A new platform should add a
sibling `tests/<os>/` lane and a matching CI job (e.g. `shellcheck` + `bats` for a bash
backend).

## License

[Apache-2.0](./LICENSE).
