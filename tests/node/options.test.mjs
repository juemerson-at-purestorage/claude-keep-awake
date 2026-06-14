import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  toBoolFlag,
  toLifetimeHours,
  sanitizeSessionId,
  sessionIdFromHookInput,
} from '../../scripts/lib/core.mjs';

// --- toBoolFlag: mirrors the v1.1.0 ConvertTo-BoolFlag contract ---

test('toBoolFlag: truthy strings -> true', () => {
  for (const v of ['true', '1', 'yes', 'on', 'TRUE', ' On ']) {
    assert.equal(toBoolFlag(v, false), true, `expected ${JSON.stringify(v)} -> true`);
  }
});

test('toBoolFlag: falsy strings -> false', () => {
  for (const v of ['false', '0', 'no', 'off', 'OFF']) {
    assert.equal(toBoolFlag(v, true), false, `expected ${JSON.stringify(v)} -> false`);
  }
});

test('toBoolFlag: empty/unknown falls back to the supplied default', () => {
  assert.equal(toBoolFlag('', false), false);
  assert.equal(toBoolFlag('', true), true);
  assert.equal(toBoolFlag(undefined, true), true);
  assert.equal(toBoolFlag('maybe', false), false);
  assert.equal(toBoolFlag('maybe', true), true);
});

// --- toLifetimeHours: mirrors ConvertTo-LifetimeHours (default 8, clamp 1..24) ---

test('toLifetimeHours: valid numbers pass through', () => {
  assert.equal(toLifetimeHours('2'), 2);
  assert.equal(toLifetimeHours('12.5'), 12.5);
});

test('toLifetimeHours: clamps below min and above max', () => {
  assert.equal(toLifetimeHours('0.5'), 1);
  assert.equal(toLifetimeHours('100'), 24);
});

test('toLifetimeHours: non-numeric / empty -> default 8', () => {
  assert.equal(toLifetimeHours(''), 8);
  assert.equal(toLifetimeHours('abc'), 8);
  assert.equal(toLifetimeHours(undefined), 8);
});

test('toLifetimeHours: custom default/min/max honored', () => {
  assert.equal(toLifetimeHours('', { default: 4, min: 1, max: 24 }), 4);
  assert.equal(toLifetimeHours('0', { default: 4, min: 2, max: 6 }), 2);
});

// --- session id handling ---

test('sanitizeSessionId: keeps UUID-safe chars, replaces others with _', () => {
  assert.equal(sanitizeSessionId('abc-123_DEF.4'), 'abc-123_DEF.4');
  assert.equal(sanitizeSessionId('a/b\\c d*e'), 'a_b_c_d_e');
});

test('sanitizeSessionId: empty/whitespace -> default', () => {
  assert.equal(sanitizeSessionId(''), 'default');
  assert.equal(sanitizeSessionId('   '), 'default');
  assert.equal(sanitizeSessionId(undefined), 'default');
});

test('sessionIdFromHookInput: extracts and sanitizes session_id', () => {
  assert.equal(sessionIdFromHookInput('{"session_id":"11111111-2222-3333"}'), '11111111-2222-3333');
});

test('sessionIdFromHookInput: empty / non-JSON / missing field -> default', () => {
  assert.equal(sessionIdFromHookInput(''), 'default');
  assert.equal(sessionIdFromHookInput('not json'), 'default');
  assert.equal(sessionIdFromHookInput('{"other":"x"}'), 'default');
});
