# keep-awake

A [Claude Code](https://code.claude.com) plugin that keeps **Windows** from going to
sleep while Claude is working, and lets it sleep normally again as soon as the turn ends.

If you kick off a long task and walk away, your machine no longer dozes off mid-run. It is
scoped per Claude session, so running several Claude windows at once is safe: one window
finishing never lets another window's machine sleep.

> **Platform:** Windows only today. The plugin is a no-op on macOS/Linux (the scripts
> detect the OS and exit cleanly). The layout is structured so other platforms can be
> added — see [Contributing](#contributing--other-platforms).

## How it works

- On **`UserPromptSubmit`**, the plugin starts a small detached background *worker* tagged
  with your `session_id`. The worker holds a Windows
  [`PowerSetRequest`](https://learn.microsoft.com/windows/win32/api/winnt/ne-winnt-power_request_type)
  of type `PowerRequestSystemRequired`, which blocks automatic system sleep while still
  letting the monitor dim. Windows clears the request automatically when the worker exits.
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

## Install

```
/plugin marketplace add github:<your-github-username>/claude-keep-awake
/plugin install keep-awake@claude-keep-awake
```

> Replace `<your-github-username>` with wherever you host this repo. The repository is
> both the plugin and its own marketplace, so a single `marketplace add` is enough.

Restart Claude Code (or reload) so the hooks register. Nothing else to configure — there
are no paths to set up.

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

- Windows only (other platforms: clean no-op).
- A worker orphaned by a hard crash persists until the 8-hour backstop fires (the next
  prompt in any session also reaps it once its process is actually gone).
- Blocks *system* sleep only; the display is still allowed to turn off.

## Contributing — other platforms

The hook **contract** is platform-agnostic:

- **In:** the hook JSON arrives on stdin and includes a stable `session_id`.
- **Out:** on `UserPromptSubmit`, start a session-scoped keep-awake; on `Stop`/`SessionEnd`,
  stop the one for that `session_id`.

A macOS implementation would wrap `caffeinate -i`; Linux would wrap `systemd-inhibit`.
Drop them under `scripts/macos/` and `scripts/linux/` and route to the right one from
`hooks/hooks.json` (e.g. via a small `pwsh` dispatcher, since PowerShell Core runs on all
three platforms). The Windows scripts in `scripts/windows/` are the reference.

## License

[Apache-2.0](./LICENSE).
