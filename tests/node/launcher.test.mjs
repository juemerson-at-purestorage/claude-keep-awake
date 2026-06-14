import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildStartProcessLauncher } from '../../scripts/lib/core.mjs';

// The launcher is a short-lived PowerShell command that Start-Process-es the detached holder
// and prints its real PID. Start-Process is the survival mechanism proven by v1.1.0 (a
// Start-Process'd worker outlives the hook); -PassThru gives us the holder's true PID so the
// unblock side can release it by id -- on Windows directly, on WSL2 via Stop-Process over
// interop (resolving the interop-child release-propagation risk).

test('buildStartProcessLauncher: Start-Process with -PassThru and hidden window', () => {
  const launcher = buildStartProcessLauncher({ command: 'powershell.exe', args: ['-NoProfile', '-EncodedCommand', 'AAAA'] });
  assert.match(launcher, /Start-Process\b/);
  assert.match(launcher, /-FilePath 'powershell\.exe'/);
  assert.match(launcher, /-PassThru/);
  assert.match(launcher, /-WindowStyle Hidden/);
});

test('buildStartProcessLauncher: each holder arg appears single-quoted in -ArgumentList', () => {
  const launcher = buildStartProcessLauncher({ command: 'powershell.exe', args: ['-NoProfile', '-EncodedCommand', 'AAAA'] });
  assert.match(launcher, /-ArgumentList @\('-NoProfile','-EncodedCommand','AAAA'\)/);
});

test('buildStartProcessLauncher: prints the spawned PID to stdout', () => {
  const launcher = buildStartProcessLauncher({ command: 'powershell.exe', args: ['-NoProfile'] });
  assert.match(launcher, /\$p\.Id/);
});

test('buildStartProcessLauncher: also emits the holder StartTime ticks (identity)', () => {
  const launcher = buildStartProcessLauncher({ command: 'powershell.exe', args: ['-NoProfile'] });
  // It captures StartTime.Ticks from the same -PassThru result (no extra process query),
  // tolerating a StartTime that isn't readable.
  assert.match(launcher, /StartTime\.Ticks/);
  assert.match(launcher, /catch/i); // guarded so a missing StartTime can't fail the launch
});

test('buildStartProcessLauncher: single quotes in an arg are PS-escaped (doubled)', () => {
  const launcher = buildStartProcessLauncher({ command: 'powershell.exe', args: ["it's"] });
  assert.match(launcher, /'it''s'/);
});
