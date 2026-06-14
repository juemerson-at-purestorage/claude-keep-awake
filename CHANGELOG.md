# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-06-14

Cross-platform release. The plugin is no longer Windows-only: a single Node dispatcher backs
every hook and branches per environment.

### Added
- **WSL2 support.** A keep-awake running inside WSL2 cannot hold the host awake (the host
  suspends the whole VM on sleep), so the dispatcher delegates to the **Windows host** over
  interop: it launches a `powershell.exe` holder that holds `PowerSetRequest`, captures the
  real host PID, and releases it on unblock via `Stop-Process` over interop. Verified live
  (block from WSL keeps the host awake; unblock releases it).
- **Cross-platform environment detection** distinguishing `win32` / `wsl` / `darwin` /
  `linux`. WSL is detected via `WSL_INTEROP`/`WSL_DISTRO_NAME` or a `microsoft` marker in
  `/proc/sys/kernel/osrelease`, with interop confirmed via the `WSLInterop` binfmt entry.
- **Node test suite** (`tests/node/`, run with `node --test`): the dispatcher's logic
  (detection, option parsing, lock model, holder/launcher construction, status formatting) is
  pure and dependency-injected, so the full block/unblock/idempotent/sweep/isolation matrix
  runs as fast unit tests on every OS.
- **`status` action** for the dispatcher; `/keep-awake-status` is now cross-platform (reports
  the Windows **host** state on WSL2 via interop, and clearly says "no-op" on macOS/Linux).

### Changed
- **Hooks now invoke `node` instead of `powershell.exe` directly** (`node dispatch.mjs
  block|unblock`, no `shell` field). The Windows keep-awake behavior is otherwise unchanged
  and was re-verified live (clean `0→1→0` execution-state differential, idempotency,
  per-session isolation, `keep_display_on`).
- The PowerShell holder is delivered via `-EncodedCommand` (one source, no file-path/`wslpath`/
  UNC translation) and launched via `Start-Process` (the survival mechanism proven by v1.1.0).
- Lock files are now JSON (`{pid, platform, startedAt, procStart}`) and live in `os.tmpdir()/
  claude-keep-awake` (the same location as before on Windows). Override with the
  `CLAUDE_KEEP_AWAKE_DIR` env var.
- **PID-reuse safety is preserved** with a cross-platform mechanism: the holder's process
  start time is captured at launch (from the same `Start-Process -PassThru` result, no extra
  query) and stored as `procStart`. On `unblock`, the holder is terminated only if the live
  PID still has that exact start time — checked and killed in one PowerShell call. A recycled
  PID belonging to an unrelated process never matches and is never signalled. Block's fast
  path stays liveness-only (no added PowerShell calls).

### Removed
- The v1.1.0 PowerShell entry points (`block-sleep.ps1`, `unblock-sleep.ps1`,
  `keepawake-worker.ps1`, `_common.ps1`, `check-keepawake.ps1`) and their Pester tests. Their
  logic now lives in the Node dispatcher (`scripts/dispatch.mjs` + `scripts/lib/`) and the two
  remaining PowerShell files (`holder.ps1`, `probe-state.ps1`).

### ⚠️ Upgrading from 1.1.0
- **Node.js is now required on PATH.** It ships with npm installs of Claude Code; if you used
  the native installer without a separate Node, install it (`winget install OpenJS.NodeJS`,
  `brew install node`, or your distro's package). Without Node the hooks simply don't run
  (benign, non-blocking) and your machine is never kept awake.
- **Native-Windows-without-Node users:** v1.1.0 (pure PowerShell, no Node) remains available
  as a tagged release/download for this exact case.

## [1.1.0] - 2026-06-13

### Added
- User-configurable options via the plugin's `userConfig` (prompted by Claude Code at enable
  time; stored in `settings.json` under `pluginConfigs`):
  - **`keep_display_on`** (default off) - also holds `PowerRequestDisplayRequired` so the
    monitor stays lit, not just the system awake. Does not prevent the lock screen.
  - **`max_lifetime_hours`** (default 8, range 1-24) - makes the worker backstop configurable
    instead of hard-coded.
- `check-keepawake.ps1` / `/keep-awake-status` now also reports whether the display is being
  kept on (`ES_DISPLAY_REQUIRED`).
- Test + CI tooling (development-only; no runtime/behavior change):
  - Pester unit tests (`tests/windows/`) for the deterministic `_common.ps1` helpers -
    option parsing (`ConvertTo-BoolFlag`, `ConvertTo-LifetimeHours`, `Get-PluginOption`)
    and the PID-reuse guard's negative paths.
  - PSScriptAnalyzer lint with a project settings file
    (`tests/windows/PSScriptAnalyzerSettings.psd1`).
  - GitHub Actions CI (`.github/workflows/ci.yml`): a platform-neutral manifest-validation
    job (JSON parse + plugin/marketplace version agreement) and a Windows job running the
    lint and Pester suite.
- README "Development" section and CI badge documenting the per-platform `scripts/<os>` +
  `tests/<os>` layout and how to run the checks locally.

### Changed
- Worker identity is now verified by command line (`keepawake-worker.ps1` + `-SessionId`) via
  `Test-IsOurWorker`, replacing bare-PID trust. This guards stale-lock reaping, idempotency,
  and stop against Windows PID reuse, so a recycled PID can never cause an unrelated process
  to be killed.
- Options are read at runtime from the `CLAUDE_PLUGIN_OPTION_*` environment Claude Code
  exports, falling back to built-in defaults when unset, rather than being substituted into
  the hook command. This means the plugin never fails to run when an option is left
  unconfigured (e.g. the config dialog was skipped).
- `Get-SessionId` now assigns an explicit empty-string fallback in its catch block instead
  of swallowing errors silently (clearer intent; satisfies `PSAvoidUsingEmptyCatchBlock`).
  Behavior is unchanged - unreadable/non-JSON stdin still falls back to the `default` session.

### Documentation
- README: added a "Configuration" section and a "When your machine sleeps vs. stays awake"
  section documenting that mid-turn permission-prompt waits intentionally keep the machine
  awake (no reliable signal exists to release safely during them).

## [1.0.0] - 2026-06-13

### Added
- Initial release as a Claude Code plugin (`keep-awake`).
- Windows keep-awake via `PowerSetRequest(PowerRequestSystemRequired)`, held by a detached
  worker for the duration of a Claude turn.
- Per-session scoping via lock files (`%TEMP%\claude-keep-awake\<session_id>.lock`), making
  multiple concurrent Claude windows safe.
- Stale-lock reaping on each prompt and an 8-hour worker max-lifetime backstop for sessions
  that crash without firing `Stop`/`SessionEnd`.
- `/keep-awake-status` diagnostic command (and `check-keepawake.ps1`) that reports the live
  system execution state with no admin required.
