import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

import {
  serializeLock,
  parseLock,
  buildHolderPrelude,
  encodePowerShellCommand,
  buildPowerShellHolderInvocation,
  buildReason,
} from '../../scripts/lib/core.mjs';

// --- lock record ---

test('serializeLock / parseLock round-trip', () => {
  const rec = { pid: 1234, platform: 'win32', startedAt: '2026-06-13T12:00:00.000Z' };
  const parsed = parseLock(serializeLock(rec));
  assert.deepEqual(parsed, rec);
});

test('serializeLock preserves optional winPid (WSL2)', () => {
  const rec = { pid: 10, platform: 'wsl', startedAt: '2026-06-13T12:00:00.000Z', winPid: 9999 };
  assert.deepEqual(parseLock(serializeLock(rec)), rec);
});

test('parseLock: garbled / empty input -> null (not a throw)', () => {
  assert.equal(parseLock('not json'), null);
  assert.equal(parseLock(''), null);
  assert.equal(parseLock('42'), null); // valid JSON but not an object with a pid
  assert.equal(parseLock('{"platform":"win32"}'), null); // missing pid
});

// --- reason string ---

test('buildReason: base reason names the session', () => {
  assert.equal(buildReason({ sessionId: 'abc', keepDisplay: false }), 'Claude Code keep-awake (session abc)');
});

test('buildReason: appends [display] marker when display kept on', () => {
  assert.equal(buildReason({ sessionId: 'abc', keepDisplay: true }), 'Claude Code keep-awake (session abc) [display]');
});

// --- PowerShell holder prelude (options embedded as safe literals) ---

test('buildHolderPrelude: emits PowerShell literals for each option', () => {
  const prelude = buildHolderPrelude({ reason: 'Claude Code keep-awake (session abc)', keepDisplay: true, maxHours: 2 });
  assert.match(prelude, /\$Reason\s*=\s*'Claude Code keep-awake \(session abc\)'/);
  assert.match(prelude, /\$KeepDisplay\s*=\s*\$true/);
  assert.match(prelude, /\$MaxHours\s*=\s*2\b/);
});

test('buildHolderPrelude: keepDisplay false -> $false', () => {
  const prelude = buildHolderPrelude({ reason: 'r', keepDisplay: false, maxHours: 8 });
  assert.match(prelude, /\$KeepDisplay\s*=\s*\$false/);
});

test('buildHolderPrelude: escapes single quotes in the reason (PS doubling)', () => {
  const prelude = buildHolderPrelude({ reason: "it's fine", keepDisplay: false, maxHours: 8 });
  assert.match(prelude, /\$Reason\s*=\s*'it''s fine'/);
});

// --- -EncodedCommand encoding (UTF-16LE + base64) ---

test('encodePowerShellCommand: matches PowerShell UTF-16LE base64', () => {
  // 'Z' (0x5A) in UTF-16LE is the two bytes 5A 00 -> base64 "WgA="
  assert.equal(encodePowerShellCommand('Z'), 'WgA=');
});

test('encodePowerShellCommand: round-trips back through UTF-16LE decode', () => {
  const script = "Write-Host 'hello $world'\n[void]0";
  const decoded = Buffer.from(encodePowerShellCommand(script), 'base64').toString('utf16le');
  assert.equal(decoded, script);
});

// --- holder invocation (command + argv) ---

test('buildPowerShellHolderInvocation: powershell.exe with -EncodedCommand', () => {
  const inv = buildPowerShellHolderInvocation({ script: 'Z' });
  assert.equal(inv.command, 'powershell.exe');
  assert.ok(inv.args.includes('-NoProfile'), 'should pass -NoProfile');
  assert.ok(inv.args.includes('-EncodedCommand'), 'should use -EncodedCommand');
  const idx = inv.args.indexOf('-EncodedCommand');
  assert.equal(inv.args[idx + 1], 'WgA=', 'encoded payload should follow the flag');
});
