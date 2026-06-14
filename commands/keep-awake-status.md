---
description: Show whether Claude Code is currently blocking your computer from sleeping, and list active keep-awake workers.
---

Run the keep-awake diagnostic script and show its output to the user verbatim. Do not
summarize or interpret beyond a one-line confirmation.

Run this command:

```
powershell.exe -NoProfile -File "${CLAUDE_PLUGIN_ROOT}\scripts\windows\check-keepawake.ps1"
```

The output reports the live `SystemExecutionState`, whether system sleep is currently
blocked (bit 0), and any active keep-awake worker processes with their session id and PID.
