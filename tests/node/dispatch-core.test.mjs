import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

import { planHolder, runDispatch } from '../../scripts/lib/dispatch-core.mjs';

// ---------------------------------------------------------------------------
// planHolder: which environments produce a real holder vs a no-op (null)
// ---------------------------------------------------------------------------

const HOLDER_BODY = '# holder body\n[void]0\n';

test('planHolder: win32 -> powershell.exe -EncodedCommand carrying prelude + body', () => {
  const inv = planHolder({ env: 'win32', sessionId: 'AAA', keepDisplay: true, maxHours: 2, holderBody: HOLDER_BODY });
  assert.equal(inv.command, 'powershell.exe');
  const encoded = inv.args[inv.args.indexOf('-EncodedCommand') + 1];
  const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
  assert.match(decoded, /\$KeepDisplay = \$true/);
  assert.match(decoded, /\$MaxHours = 2/);
  assert.match(decoded, /\$Reason = 'Claude Code keep-awake \(session AAA\) \[display\]'/);
  assert.ok(decoded.includes(HOLDER_BODY.trim()), 'holder body should be embedded');
});

test('planHolder: wsl WITH interop -> same powershell.exe invocation', () => {
  const inv = planHolder({ env: 'wsl', sessionId: 'AAA', keepDisplay: false, maxHours: 8, holderBody: HOLDER_BODY, interopAvailable: true });
  assert.equal(inv.command, 'powershell.exe');
  assert.ok(inv.args.includes('-EncodedCommand'));
});

test('planHolder: wsl WITHOUT interop -> null (benign no-op)', () => {
  assert.equal(planHolder({ env: 'wsl', sessionId: 'AAA', keepDisplay: false, maxHours: 8, holderBody: HOLDER_BODY, interopAvailable: false }), null);
});

test('planHolder: darwin and linux -> null (not yet implemented)', () => {
  assert.equal(planHolder({ env: 'darwin', sessionId: 'AAA', keepDisplay: false, maxHours: 8, holderBody: HOLDER_BODY }), null);
  assert.equal(planHolder({ env: 'linux', sessionId: 'AAA', keepDisplay: false, maxHours: 8, holderBody: HOLDER_BODY }), null);
});

// ---------------------------------------------------------------------------
// runDispatch: lock model with injected side effects
// ---------------------------------------------------------------------------

// In-memory lock store + spawn/kill/liveness fakes, recording calls.
function harness({ alivePids = new Set(), nextPid = 5000 } = {}) {
  const locks = new Map(); // sessionId -> { record, mtime }
  const spawns = [];
  const kills = [];
  const killRecords = [];
  let clock = 0;
  let pidCounter = nextPid;
  const live = new Set(alivePids);

  const deps = {
    store: {
      list: () => [...locks.keys()],
      read: (sid) => (locks.has(sid) ? locks.get(sid).record : null),
      write: (sid, record) => locks.set(sid, { record, mtime: clock }),
      remove: (sid) => locks.delete(sid),
      touch: (sid) => { if (locks.has(sid)) locks.get(sid).mtime = clock; },
    },
    isAlive: (pid) => live.has(pid),
    // spawn returns the launched holder's identity: { pid, procStart }.
    spawn: (inv) => { spawns.push(inv); const pid = pidCounter++; live.add(pid); return { pid, procStart: 1000 + pid }; },
    // kill receives the whole lock record so the real impl can verify identity before killing.
    kill: (rec) => { kills.push(rec.pid); killRecords.push(rec); live.delete(rec.pid); },
    now: () => new Date(Date.UTC(2026, 5, 13, 12, 0, clock)),
    log: () => {},
    holderBody: HOLDER_BODY,
  };
  return { deps, locks, spawns, kills, killRecords, live, tick: () => { clock += 1; } };
}

const baseOpts = { keepDisplay: false, maxHours: 8 };

test('block (win32): starts exactly one holder and writes a live lock', () => {
  const h = harness();
  const r = runDispatch({ action: 'block', env: 'win32', sessionId: 'AAA', options: baseOpts, deps: h.deps });
  assert.equal(r.result, 'started');
  assert.equal(h.spawns.length, 1);
  const rec = h.deps.store.read('AAA');
  assert.equal(rec.platform, 'win32');
  assert.equal(rec.pid, r.pid);
  assert.equal(rec.procStart, 1000 + r.pid, 'lock records the holder start time for identity checks');
  assert.ok(h.live.has(rec.pid));
});

test('unblock hands the full lock record (incl procStart) to kill for identity verification', () => {
  const h = harness();
  runDispatch({ action: 'block', env: 'win32', sessionId: 'AAA', options: baseOpts, deps: h.deps });
  const rec = h.deps.store.read('AAA');
  runDispatch({ action: 'unblock', env: 'win32', sessionId: 'AAA', options: baseOpts, deps: h.deps });
  assert.equal(h.killRecords.length, 1);
  assert.equal(h.killRecords[0].pid, rec.pid);
  assert.equal(h.killRecords[0].procStart, rec.procStart);
});

test('block twice for same session is idempotent (no second holder)', () => {
  const h = harness();
  runDispatch({ action: 'block', env: 'win32', sessionId: 'AAA', options: baseOpts, deps: h.deps });
  const r2 = runDispatch({ action: 'block', env: 'win32', sessionId: 'AAA', options: baseOpts, deps: h.deps });
  assert.equal(r2.result, 'already-running');
  assert.equal(h.spawns.length, 1);
});

test('block for a second session spawns an independent holder', () => {
  const h = harness();
  runDispatch({ action: 'block', env: 'win32', sessionId: 'AAA', options: baseOpts, deps: h.deps });
  runDispatch({ action: 'block', env: 'win32', sessionId: 'BBB', options: baseOpts, deps: h.deps });
  assert.equal(h.spawns.length, 2);
  assert.notEqual(h.deps.store.read('AAA').pid, h.deps.store.read('BBB').pid);
});

test('unblock releases only the named session (per-session isolation)', () => {
  const h = harness();
  runDispatch({ action: 'block', env: 'win32', sessionId: 'AAA', options: baseOpts, deps: h.deps });
  runDispatch({ action: 'block', env: 'win32', sessionId: 'BBB', options: baseOpts, deps: h.deps });
  const bbbPid = h.deps.store.read('BBB').pid;
  const aaaPid = h.deps.store.read('AAA').pid;

  const r = runDispatch({ action: 'unblock', env: 'win32', sessionId: 'AAA', options: baseOpts, deps: h.deps });
  assert.equal(r.result, 'released');
  assert.deepEqual(h.kills, [aaaPid]);
  assert.equal(h.deps.store.read('AAA'), null);
  assert.ok(h.deps.store.read('BBB'), 'BBB lock survives');
  assert.ok(h.live.has(bbbPid), 'BBB holder is untouched');
});

test('block sweeps a stale lock whose holder PID is dead', () => {
  const h = harness();
  // Seed a lock for a session whose recorded PID is NOT alive.
  h.deps.store.write('ZOMBIE', { pid: 4242, platform: 'win32', startedAt: '2026-06-13T00:00:00.000Z' });
  assert.ok(!h.live.has(4242));

  runDispatch({ action: 'block', env: 'win32', sessionId: 'AAA', options: baseOpts, deps: h.deps });
  assert.equal(h.deps.store.read('ZOMBIE'), null, 'stale lock should be swept');
});

test('block restarts when this session\'s recorded holder is dead', () => {
  const h = harness();
  h.deps.store.write('AAA', { pid: 9001, platform: 'win32', startedAt: '2026-06-13T00:00:00.000Z' }); // dead pid
  const r = runDispatch({ action: 'block', env: 'win32', sessionId: 'AAA', options: baseOpts, deps: h.deps });
  assert.equal(r.result, 'started');
  assert.equal(h.spawns.length, 1);
  assert.ok(h.live.has(h.deps.store.read('AAA').pid));
});

test('unblock when nothing is running is a harmless no-op', () => {
  const h = harness();
  const r = runDispatch({ action: 'unblock', env: 'win32', sessionId: 'AAA', options: baseOpts, deps: h.deps });
  assert.equal(r.result, 'not-running');
  assert.equal(h.kills.length, 0);
});

test('block on an unsupported backend (linux) is a no-op: no spawn, no lock', () => {
  const h = harness();
  const r = runDispatch({ action: 'block', env: 'linux', sessionId: 'AAA', options: baseOpts, deps: h.deps });
  assert.equal(r.result, 'noop');
  assert.equal(h.spawns.length, 0);
  assert.equal(h.deps.store.read('AAA'), null);
});

test('block on wsl without interop is a no-op', () => {
  const h = harness();
  const r = runDispatch({ action: 'block', env: 'wsl', sessionId: 'AAA', options: baseOpts, deps: { ...h.deps, interopAvailable: false } });
  assert.equal(r.result, 'noop');
  assert.equal(h.spawns.length, 0);
});

test('block on wsl with interop spawns the holder', () => {
  const h = harness();
  const r = runDispatch({ action: 'block', env: 'wsl', sessionId: 'AAA', options: baseOpts, deps: { ...h.deps, interopAvailable: true } });
  assert.equal(r.result, 'started');
  assert.equal(h.spawns.length, 1);
  assert.equal(h.deps.store.read('AAA').platform, 'wsl');
});
