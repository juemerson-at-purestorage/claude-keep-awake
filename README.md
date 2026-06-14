# keep-awake

[![CI](https://github.com/juemerson-at-purestorage/claude-keep-awake/actions/workflows/ci.yml/badge.svg)](https://github.com/juemerson-at-purestorage/claude-keep-awake/actions/workflows/ci.yml)

A [Claude Code](https://code.claude.com) plugin that keeps your **computer** from going to
sleep while Claude is working, and lets it sleep normally again as soon as the turn ends.

If you kick off a long task and walk away, your machine no longer dozes off mid-run. It is
scoped per Claude session, so running several Claude windows at once is safe: one window
finishing never lets another window's machine sleep.

## Platform support

| Platform | Status | Mechanism |
|----------|--------|-----------|
| **Windows** | ✅ Implemented | `PowerSetRequest(PowerRequestSystemRequired)` held by a detached `powershell.exe` |
| **WSL2** (on Windows) | ✅ Implemented | Delegates to the **Windows host** over interop (a keep-awake *inside* WSL2 can't stop the host sleeping) |
| **macOS** | ⏳ Detected, no-op | Reserved for `caffeinate` — contributions welcome |
| **Linux** (bare metal) | ⏳ Detected, no-op | Reserved for `systemd-inhibit` — contributions welcome |

On macOS and bare-metal Linux the plugin detects the OS and exits cleanly (a harmless
no-op), so it is safe to install anywhere.

### Requirements

**Node.js must be on your `PATH`.** Every hook runs through a single Node dispatcher
(`scripts/dispatch.mjs`), which is what lets one plugin work across Windows, WSL2, macOS, and
Linux. Node ships with npm installs of Claude Code; if you used the native installer without a
separate Node, install it:

- **Windows:** `winget install OpenJS.NodeJS`
- **macOS:** `brew install node`
- **Linux/WSL2:** your distro's package (e.g. `sudo apt install nodejs`)

If Node isn't present the hooks simply don't run — a benign, non-blocking no-op — and your
machine is never kept awake. (Need a pure-PowerShell, no-Node Windows build? Use the tagged
**v1.1.0** release.)

## How it works

A single Node dispatcher backs every hook and branches per environment — no `shell` field, so
the same `hooks.json` works everywhere:

- On **`UserPromptSubmit`** → `node dispatch.mjs block`: detect the environment, then start a
  detached, session-scoped *holder* that blocks idle system sleep.
- On **`Stop`** and **`SessionEnd`** → `node dispatch.mjs unblock`: stop that session's holder.

The dispatcher records each holder in a per-session JSON lock file
(`<os-temp>/claude-keep-awake/<session_id>.lock`) and releases by the recorded PID.

**Windows.** The holder is a detached `powershell.exe` (launched via `Start-Process`,
delivered as an `-EncodedCommand`) holding a
[`PowerSetRequest`](https://learn.microsoft.com/windows/win32/api/winnt/ne-winnt-power_request_type)
of type `PowerRequestSystemRequired`, which blocks automatic system sleep while still letting
the monitor dim. With [`keep_display_on`](#configuration) it also holds
`PowerRequestDisplayRequired`. Windows clears the request automatically when the holder exits.

**WSL2.** A keep-awake running *inside* WSL2 can't help — when Windows sleeps it suspends the
entire WSL2 VM, and `systemd-inhibit` inside the VM is useless. So the dispatcher delegates to
the **Windows host**: over [interop](https://learn.microsoft.com/windows/wsl/interop) it launches
the *same* `powershell.exe` holder on the host, captures the host's real PID, and on unblock
terminates it by PID (`Stop-Process` over interop). If interop is disabled, it degrades to a
benign no-op.

### Robustness

- **Idempotent:** re-prompting in a session that already has a live holder just refreshes the
  lock; it never stacks duplicate holders.
- **Stale-lock reaping:** each `block` sweeps lock files whose recorded process is gone.
- **PID-reuse-safe release:** the holder's start time is captured at launch and `unblock` only
  terminates the PID if its live start time still matches — so a recycled PID belonging to an
  unrelated process is never signalled.
- **Max-lifetime backstop:** if a session crashes without firing `Stop`/`SessionEnd`, its
  holder self-releases after a hard ceiling (default 8 hours) instead of surviving until reboot.
- **Hooks never block Claude:** the dispatcher wraps everything and always exits 0; a missing
  `node`/`powershell.exe`, disabled interop, or an unsupported OS all degrade to a no-op.

### When your machine sleeps vs. stays awake

The block is held only while a turn is actively running:

- **Claude is working** (thinking, running commands, including long-running commands and
  subagents) — the system stays awake.
- **The turn finishes and Claude is waiting for your next prompt** — the holder is released
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

Make sure [Node.js is installed](#requirements), then restart Claude Code (or reload) so the
hooks register. Nothing else to configure — there are no paths to set up.

## Configuration

The plugin works out of the box; these options are optional. Claude Code prompts for them
when you enable the plugin and stores them in your `settings.json` under `pluginConfigs`.

| Option | Default | What it does |
|--------|---------|--------------|
| **Keep the display on too** (`keep_display_on`) | off | Also keeps the monitor lit while Claude works, not just the system awake. **Does not prevent the lock screen** (see below). |
| **Max keep-awake hours** (`max_lifetime_hours`) | `8` | Safety backstop: a holder self-releases after this many hours (range 1–24) if a session ever crashes without cleaning up. No normal turn comes close. |

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

Run the bundled status command (no admin needed):

```
/keep-awake-status
```

or directly:

```
node "<plugin-root>/scripts/dispatch.mjs" status
```

It reports the detected environment, a `System sleep blocked : True/False` verdict (the
Windows **host** state on WSL2), whether the display is being kept on, and any active holders
with their session id, platform, PID, and liveness. The decisive test is differential — submit
a prompt and you should see `True` while Claude works, returning to `False` after the turn ends.

## Limitations

- macOS and bare-metal Linux are not implemented yet (clean no-op there) — contributions
  welcome.
- A holder orphaned by a hard crash persists until the max-lifetime backstop fires (default
  8 hours, configurable; the next prompt in any session also reaps it once its process is gone).
- Never prevents the **lock screen** — only system sleep and (optionally) display-off. See
  [Configuration](#configuration).
- By default blocks *system* sleep only and lets the display turn off; set `keep_display_on`
  to keep the monitor lit as well.
- Requires Node.js on `PATH` (see [Requirements](#requirements)).

## Architecture & contributing

Everything routes through the Node dispatcher; the decision logic is pure and unit-tested,
and the side effects are concentrated in one file:

```
scripts/
  dispatch.mjs          universal entry: stdin → session id, detect env, run the lock model
  lib/core.mjs          pure helpers: detection, option parsing, locks, holder/launcher, status
  lib/dispatch-core.mjs orchestration: planHolder() + runDispatch() (dependency-injected)
  windows/holder.ps1    the PowerSetRequest holder body (win32 + wsl, via -EncodedCommand)
  windows/probe-state.ps1  the power-state probe used by `status`
hooks/hooks.json        platform-agnostic hook wiring (node dispatch.mjs block|unblock)
tests/node/             node --test unit suite for the dispatcher
tests/windows/          PSScriptAnalyzer settings for the remaining PowerShell
```

**Adding macOS or Linux** is a focused change: teach `planHolder()` in
`scripts/lib/dispatch-core.mjs` to return a holder for that environment instead of `null`, and
have `dispatch.mjs` launch/terminate it. The two `userConfig` options map cleanly:

| Concept | Windows / WSL2 | macOS | Linux |
|---------|----------------|-------|-------|
| Block system sleep (always) | `PowerRequestSystemRequired` | `caffeinate -i` | `systemd-inhibit --what=sleep` |
| `keep_display_on` | `PowerRequestDisplayRequired` | `caffeinate -d` | `systemd-inhibit --what=idle` (best-effort) |
| `max_lifetime_hours` backstop | holder self-exit timer | `caffeinate -t` | holder `sleep` duration |

Notes for those backends: `systemd-inhibit` has **no** timeout flag, so a backstop duration is
required for `max_lifetime_hours` parity; the Linux `idle` inhibitor is honored only by desktop
environments that respect `logind` (GNOME/KDE), so `keep_display_on` there is best-effort. None
of these tools prevent the lock screen on any platform.

## Development

```bash
npm test        # node --test over tests/node/  (pure, runs on any OS)
```

Or directly: `node --test` (auto-discovers the `tests/node/` suite).

CI runs on every push and pull request ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

- **Validate manifests** (platform-neutral): every `*.json` parses, and `plugin.json` /
  `marketplace.json` / `package.json` agree on the plugin name and version.
- **Node dispatcher tests**: `node --test` on Ubuntu and Windows.
- **Windows PowerShell lint**:
  [PSScriptAnalyzer](https://github.com/PowerShell/PSScriptAnalyzer) over `scripts/`.

The detached-holder *survival* across the hook process exiting is the one behavior that can
only be confirmed by a real plugin run (test harnesses reap background processes); the rest of
the lifecycle is covered by the Node suite and the [status](#verify-it-works) differential.

## License

[Apache-2.0](./LICENSE).
