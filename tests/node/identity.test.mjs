import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseHolderLaunch, buildVerifyAndKillCommand } from '../../scripts/lib/core.mjs';

// --- parseHolderLaunch: read "<pid> <startTicks>" from the launcher's stdout ---
// procStart is kept as a STRING: .NET DateTime.Ticks (~6.4e17) exceeds JS's safe-integer
// limit (~9e15), so parsing it to a Number would round it and break the identity match.

test('parseHolderLaunch: extracts pid (number) and procStart (string, full precision)', () => {
  assert.deepEqual(parseHolderLaunch('15184 638850000000000000'), { pid: 15184, procStart: '638850000000000000' });
});

test('parseHolderLaunch: preserves a tick value beyond Number.MAX_SAFE_INTEGER exactly', () => {
  // 639169888939201900 round-trips lossily through a JS Number; as a string it stays exact.
  assert.equal(parseHolderLaunch('100 639169888939201907').procStart, '639169888939201907');
});

test('parseHolderLaunch: tolerates surrounding whitespace/newlines', () => {
  assert.deepEqual(parseHolderLaunch('\n 15184 638850000000000000 \r\n'), { pid: 15184, procStart: '638850000000000000' });
});

test('parseHolderLaunch: pid only (no ticks) -> procStart null', () => {
  assert.deepEqual(parseHolderLaunch('15184'), { pid: 15184, procStart: null });
});

test('parseHolderLaunch: no pid -> null pid', () => {
  assert.deepEqual(parseHolderLaunch('garbage'), { pid: null, procStart: null });
});

// --- buildVerifyAndKillCommand: terminate ONLY if the live process matches our start time ---

test('buildVerifyAndKillCommand: reads the PID and gates Stop-Process on a start-time match', () => {
  const cmd = buildVerifyAndKillCommand(15184, 638850000000000000);
  assert.match(cmd, /Get-Process -Id 15184/);
  assert.match(cmd, /StartTime\.Ticks/);
  assert.match(cmd, /638850000000000000/);
  assert.match(cmd, /Stop-Process -Id 15184 -Force/);
});

test('buildVerifyAndKillCommand: Stop-Process is conditional, not unconditional', () => {
  const cmd = buildVerifyAndKillCommand(15184, 638850000000000000);
  // The Stop-Process must sit inside an `if` (the start-time equality guard), so a recycled
  // PID belonging to an unrelated process is never terminated.
  const ifIdx = cmd.search(/\bif\b/);
  const stopIdx = cmd.indexOf('Stop-Process');
  assert.ok(ifIdx >= 0 && ifIdx < stopIdx, 'Stop-Process should be guarded by an if');
});
