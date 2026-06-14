#!/usr/bin/env node
// Universal cross-platform entry point for every claude-keep-awake hook.
//
// Invoked by hooks.json as:  node "${CLAUDE_PLUGIN_ROOT}/scripts/dispatch.mjs" <block|unblock>
// No `shell` field is used -- `node` is the single portable runtime that branches per-OS, so
// the same command works on Windows, WSL2, macOS, and Linux (see the v1.2.0 design notes).
//
// Responsibilities: read the hook's stdin JSON for the session id, detect the environment,
// read the user options, and run the per-session lock model (block/unblock). All real I/O is
// concentrated here; the decision logic lives in ./lib (pure, unit-tested).
//
// INVARIANT: a hook must never block Claude. Everything is wrapped so we ALWAYS exit 0, and we
// never emit a blocking decision. A missing `node`, missing `powershell.exe`, disabled WSL
// interop, or an unsupported OS all degrade to a benign no-op.

import { readFileSync, writeFileSync, unlinkSync, readdirSync, mkdirSync, utimesSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  detectEnvironment,
  isInteropAvailable,
  sessionIdFromHookInput,
  toBoolFlag,
  toLifetimeHours,
  serializeLock,
  parseLock,
  buildStartProcessLauncher,
  encodePowerShellCommand,
  parseHolderLaunch,
  buildVerifyAndKillCommand,
  parseProbeOutput,
  formatStatusReport,
} from './lib/core.mjs';
import { runDispatch } from './lib/dispatch-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// Read a file as text, returning null on any failure (used both for /proc detection and the
// holder body). Detection MUST tolerate absence -- /proc does not exist on Windows.
function readFileText(path) {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

// Read the hook event JSON from stdin. Hooks deliver it on a closed pipe, so a synchronous
// read returns immediately; guard against a TTY (manual run) where it would otherwise block.
function readStdin() {
  if (process.stdin.isTTY) return '';
  try {
    return readFileSync(0, 'utf-8');
  } catch {
    return '';
  }
}

// Per-user lock dir. Overridable via CLAUDE_KEEP_AWAKE_DIR (used for isolated testing so we
// never collide with a real session's locks); defaults under the OS temp dir.
function lockDir() {
  const dir = process.env.CLAUDE_KEEP_AWAKE_DIR || join(tmpdir(), 'claude-keep-awake');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function lockPath(dir, sessionId) {
  return join(dir, `${sessionId}.lock`);
}

// fs-backed implementation of the lock store contract consumed by runDispatch.
function makeStore(dir) {
  return {
    list() {
      try {
        return readdirSync(dir)
          .filter((f) => f.endsWith('.lock'))
          .map((f) => f.slice(0, -'.lock'.length));
      } catch {
        return [];
      }
    },
    read(sessionId) {
      return parseLock(readFileText(lockPath(dir, sessionId)));
    },
    write(sessionId, record) {
      writeFileSync(lockPath(dir, sessionId), serializeLock(record));
    },
    remove(sessionId) {
      try {
        unlinkSync(lockPath(dir, sessionId));
      } catch {
        /* already gone */
      }
    },
    touch(sessionId) {
      try {
        const now = new Date();
        utimesSync(lockPath(dir, sessionId), now, now);
      } catch {
        /* lock vanished between read and touch; harmless */
      }
    },
  };
}

// Run a short PowerShell command, capturing stdout. On win32 this is the local powershell.exe;
// on wsl it is the host's powershell.exe over interop. Returns { status, stdout } (status null
// if the launch itself failed, e.g. powershell.exe not found / interop disabled).
function runPowerShell(command) {
  const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShellCommand(command)], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return { status: res.error ? null : res.status, stdout: res.stdout || '' };
}

// Launch the detached holder via Start-Process and return its identity { pid, procStart } (on
// wsl, the real Windows host PID + its start time). procStart is captured from the same
// -PassThru launch -- no extra process query. Returns null if the launch failed.
function launchHolder(invocation) {
  const { status, stdout } = runPowerShell(buildStartProcessLauncher(invocation));
  if (status !== 0) return null;
  const { pid, procStart } = parseHolderLaunch(stdout);
  return pid ? { pid, procStart } : null;
}

// Liveness + termination, keyed by environment.
//   isAlive(pid): a cheap liveness probe used by block's sweep/idempotent fast path -- node's
//     process.kill(pid, 0) on win32 (no PowerShell), interop Get-Process on wsl.
//   kill(record): used only at unblock. Verifies the live PID still has the recorded start
//     time, then terminates -- in ONE PowerShell call, so a recycled PID belonging to an
//     unrelated process is never signalled (PID-reuse-safe), with no check-then-kill race.
function makeLifecycle(env) {
  const verifyAndKill = (record) => {
    if (!record || !record.pid) return;
    if (record.procStart === undefined || record.procStart === null) {
      // No identity captured (e.g. a pre-identity lock). Favor NOT killing over possibly
      // signalling the wrong process; the holder self-releases at its backstop.
      return;
    }
    runPowerShell(buildVerifyAndKillCommand(record.pid, record.procStart));
  };

  if (env === 'wsl') {
    return {
      isAlive: (pid) => runPowerShell(`if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }`).status === 0,
      kill: verifyAndKill,
    };
  }
  return {
    isAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (e) {
        return e && e.code === 'EPERM'; // exists, just not signallable by us
      }
    },
    kill: verifyAndKill,
  };
}

// Read and print the cross-platform status report (the /keep-awake-status command). Writes to
// stdout so the user sees it; never throws out (a status read must not fail the session).
function runStatus(env, lifecycle) {
  const store = makeStore(lockDir());
  const locks = store.list().map((sessionId) => {
    const record = store.read(sessionId);
    return { sessionId, record, alive: record ? lifecycle.isAlive(record.pid) : false };
  });

  let state;
  if (env === 'win32' || env === 'wsl') {
    // Probe the live power state. On wsl this runs over interop and reports the HOST state.
    const probe = runPowerShell(readFileText(join(HERE, 'windows', 'probe-state.ps1')) ?? '');
    const parsed = parseProbeOutput(probe.stdout);
    state = { supported: true, ...parsed };
  } else {
    state = { supported: false };
  }

  process.stdout.write(formatStatusReport({ env, state, locks, now: new Date() }) + '\n');
}

function main() {
  const action = process.argv[2];
  if (action !== 'block' && action !== 'unblock' && action !== 'status') {
    // Misconfigured hook command -- do nothing, but never fail.
    return;
  }

  const env = detectEnvironment({ platform: process.platform, env: process.env, readFileText });
  const lifecycle = makeLifecycle(env);

  if (action === 'status') {
    runStatus(env, lifecycle);
    return;
  }

  const sessionId = sessionIdFromHookInput(readStdin());

  const options = {
    keepDisplay: toBoolFlag(process.env.CLAUDE_PLUGIN_OPTION_KEEP_DISPLAY_ON, false),
    maxHours: toLifetimeHours(process.env.CLAUDE_PLUGIN_OPTION_MAX_LIFETIME_HOURS, { default: 8, min: 1, max: 24 }),
  };

  const deps = {
    store: makeStore(lockDir()),
    isAlive: lifecycle.isAlive,
    spawn: launchHolder,
    kill: lifecycle.kill,
    now: () => new Date(),
    log: (msg) => { try { process.stderr.write(`${msg}\n`); } catch { /* ignore */ } },
    holderBody: readFileText(join(HERE, 'windows', 'holder.ps1')) ?? '',
    interopAvailable: env === 'wsl' ? isInteropAvailable({ readFileText }) : false,
  };

  runDispatch({ action, env, sessionId, options, deps });
}

// Only run when invoked directly (keeps the module import-safe for any future test harness).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch {
    // Last-resort guard: a hook must never break Claude.
  }
  process.exit(0);
}
