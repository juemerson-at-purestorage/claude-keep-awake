// Orchestration for the cross-platform dispatcher: choosing a platform holder and running
// the per-session lock model. Both functions are dependency-injected (no direct fs/process
// access), so the full block/unblock/idempotent/sweep/isolation matrix is exercised by fast
// unit tests with in-memory fakes, and dispatch.mjs supplies the real implementations.

import {
  buildReason,
  buildHolderPrelude,
  buildPowerShellHolderInvocation,
} from './core.mjs';

// Decide how to hold the machine awake for a given environment, or return null when the
// environment has no working backend (so the caller degrades to a benign no-op).
//
//   win32          -> powershell.exe -EncodedCommand holding PowerSetRequest
//   wsl + interop  -> same, launched over WSL interop (holds the request on the HOST)
//   wsl, no interop-> null  (a keep-awake inside the WSL2 VM cannot hold the host awake)
//   darwin, linux  -> null  (native backends not implemented yet; detected but no-op)
export function planHolder({ env, sessionId, keepDisplay, maxHours, holderBody, interopAvailable }) {
  if (env === 'wsl' && !interopAvailable) return null;
  if (env !== 'win32' && env !== 'wsl') return null;

  const reason = buildReason({ sessionId, keepDisplay });
  const prelude = buildHolderPrelude({ reason, keepDisplay, maxHours });
  const script = prelude + holderBody;
  return buildPowerShellHolderInvocation({ script });
}

// Run one dispatch action ('block' | 'unblock') for a session.
//
// deps: {
//   store: { list(), read(sid), write(sid, rec), remove(sid), touch(sid) },
//   isAlive(pid) -> bool,
//   spawn({command, args}) -> pid | null,   // detached holder launch
//   kill(pid) -> void,                       // best-effort terminate
//   now() -> Date,
//   log(msg) -> void,
//   holderBody: string,                      // contents of holder.ps1
//   interopAvailable?: bool,                 // wsl only
// }
export function runDispatch({ action, env, sessionId, options, deps }) {
  if (action === 'unblock') return unblock({ sessionId, deps });
  return block({ env, sessionId, options, deps });
}

function block({ env, sessionId, options, deps }) {
  // 1) Sweep: drop any lock whose recorded holder PID is gone (crashed, self-released at the
  //    backstop, or a corrupt record). This is also how a stale lock for THIS session clears.
  for (const sid of deps.store.list()) {
    const rec = deps.store.read(sid);
    if (!rec || !deps.isAlive(rec.pid)) deps.store.remove(sid);
  }

  // 2) Idempotent: after the sweep, any surviving lock is live. If this session already has
  //    one, just refresh it and exit -- no second holder.
  const existing = deps.store.read(sessionId);
  if (existing) {
    deps.store.touch(sessionId);
    return { result: 'already-running', pid: existing.pid };
  }

  // 3) Pick a holder for this environment; null means there is nothing useful to run here.
  const invocation = planHolder({
    env,
    sessionId,
    keepDisplay: options.keepDisplay,
    maxHours: options.maxHours,
    holderBody: deps.holderBody,
    interopAvailable: deps.interopAvailable,
  });
  if (!invocation) {
    deps.log(`keep-awake: no backend for environment '${env}' -- not blocking sleep (no-op).`);
    return { result: 'noop', env };
  }

  // 4) Launch the detached holder. spawn returns the holder's identity { pid, procStart }; a
  //    failed launch (e.g. powershell.exe / node missing) is benign: log and exit without a
  //    lock so we never falsely report a block.
  const launched = deps.spawn(invocation);
  if (!launched || !launched.pid) {
    deps.log(`keep-awake: failed to launch holder for environment '${env}' -- not blocking sleep.`);
    return { result: 'spawn-failed', env };
  }

  // 5) Record the lock so unblock can find and release this exact holder. procStart (the
  //    holder's process start time) is the PID-reuse-safe identity unblock verifies before
  //    killing.
  const record = { pid: launched.pid, platform: env, startedAt: deps.now().toISOString(), procStart: launched.procStart };
  deps.store.write(sessionId, record);
  return { result: 'started', pid: launched.pid };
}

function unblock({ sessionId, deps }) {
  const rec = deps.store.read(sessionId);
  if (!rec) return { result: 'not-running' };
  // Terminate the recorded holder; the OS releases its power request on process exit. kill
  // receives the whole record so it can confirm the live PID is still our holder (start-time
  // match) before signalling -- a recycled PID belonging to a stranger is left untouched.
  deps.kill(rec);
  deps.store.remove(sessionId);
  return { result: 'released', pid: rec.pid };
}
