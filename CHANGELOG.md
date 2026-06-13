# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

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
