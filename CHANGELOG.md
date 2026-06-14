# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

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

### Changed
- Worker identity is now verified by command line (`keepawake-worker.ps1` + `-SessionId`) via
  `Test-IsOurWorker`, replacing bare-PID trust. This guards stale-lock reaping, idempotency,
  and stop against Windows PID reuse, so a recycled PID can never cause an unrelated process
  to be killed.
- Options are read at runtime from the `CLAUDE_PLUGIN_OPTION_*` environment Claude Code
  exports, falling back to built-in defaults when unset, rather than being substituted into
  the hook command. This means the plugin never fails to run when an option is left
  unconfigured (e.g. the config dialog was skipped).

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
