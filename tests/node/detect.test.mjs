import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectEnvironment, isInteropAvailable } from '../../scripts/lib/core.mjs';

// A readFileText stub that serves a fixed map of path -> contents; unknown paths return null.
const fsOf = (map) => (p) => (Object.prototype.hasOwnProperty.call(map, p) ? map[p] : null);
const noFs = () => null;

test('detectEnvironment: win32 platform -> win32', () => {
  assert.equal(detectEnvironment({ platform: 'win32', env: {}, readFileText: noFs }), 'win32');
});

test('detectEnvironment: darwin platform -> darwin', () => {
  assert.equal(detectEnvironment({ platform: 'darwin', env: {}, readFileText: noFs }), 'darwin');
});

test('detectEnvironment: plain linux (no WSL signals) -> linux', () => {
  const env = {};
  const readFileText = fsOf({ '/proc/sys/kernel/osrelease': '6.8.0-generic\n' });
  assert.equal(detectEnvironment({ platform: 'linux', env, readFileText }), 'linux');
});

test('detectEnvironment: linux + WSL_INTEROP env -> wsl', () => {
  const env = { WSL_INTEROP: '/run/WSL/8_interop' };
  assert.equal(detectEnvironment({ platform: 'linux', env, readFileText: noFs }), 'wsl');
});

test('detectEnvironment: linux + WSL_DISTRO_NAME env -> wsl', () => {
  const env = { WSL_DISTRO_NAME: 'Ubuntu' };
  assert.equal(detectEnvironment({ platform: 'linux', env, readFileText: noFs }), 'wsl');
});

test('detectEnvironment: linux + microsoft in osrelease -> wsl (case-insensitive)', () => {
  const env = {};
  const readFileText = fsOf({ '/proc/sys/kernel/osrelease': '5.15.167.4-microsoft-standard-WSL2\n' });
  assert.equal(detectEnvironment({ platform: 'linux', env, readFileText }), 'wsl');
});

test('detectEnvironment: osrelease "Microsoft" mixed case still detected', () => {
  const env = {};
  const readFileText = fsOf({ '/proc/sys/kernel/osrelease': '4.4.0-19041-Microsoft\n' });
  assert.equal(detectEnvironment({ platform: 'linux', env, readFileText }), 'wsl');
});

test('isInteropAvailable: true when WSLInterop binfmt entry exists', () => {
  const readFileText = fsOf({ '/proc/sys/fs/binfmt_misc/WSLInterop': 'enabled\ninterpreter /init\n' });
  assert.equal(isInteropAvailable({ readFileText }), true);
});

test('isInteropAvailable: true via WSLInterop_late fallback entry', () => {
  const readFileText = fsOf({ '/proc/sys/fs/binfmt_misc/WSLInterop-late': 'enabled\n' });
  assert.equal(isInteropAvailable({ readFileText }), true);
});

test('isInteropAvailable: false when no binfmt entry exists', () => {
  assert.equal(isInteropAvailable({ readFileText: noFs }), false);
});

test('isInteropAvailable: false when entry exists but is disabled', () => {
  const readFileText = fsOf({ '/proc/sys/fs/binfmt_misc/WSLInterop': 'disabled\n' });
  assert.equal(isInteropAvailable({ readFileText }), false);
});
