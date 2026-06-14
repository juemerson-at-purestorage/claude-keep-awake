---
description: Show whether Claude Code is currently blocking your computer from sleeping, and list active keep-awake workers.
---

Run the keep-awake status command and show its output to the user verbatim. Do not summarize
or interpret beyond a one-line confirmation.

Run this command:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/dispatch.mjs" status
```

The output reports the detected environment (win32 / wsl / darwin / linux), whether system
sleep is currently blocked and whether the display is being kept on, and any active keep-awake
worker locks with their session id, platform, PID, and liveness. On WSL2 the power state is the
Windows **host** state (queried over interop); on macOS/Linux the backend is a no-op in v1.2.0
and the report says so.
