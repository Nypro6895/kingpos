import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { selectSimulator } from '../scripts/ios/select-simulator.mjs';

const phone = '00112233-4455-6677-8899-AABBCCDDEE01';
const pad = '00112233-4455-6677-8899-AABBCCDDEE02';
const inventory = { devices: {
  'com.apple.CoreSimulator.SimRuntime.tvOS-26-2': [{ name: 'iPad invalid runtime', isAvailable: true, udid: phone }],
  'com.apple.CoreSimulator.SimRuntime.iOS-26-1': [{ name: 'iPad Pro 13-inch (M5)', isAvailable: false, udid: phone }],
  'com.apple.CoreSimulator.SimRuntime.iOS-26-2': [
    { name: 'iPhone 17', isAvailable: true, udid: phone, state: 'Shutdown' },
    { name: 'iPad Pro 13-inch (M5)', isAvailable: true, udid: pad, state: 'Shutdown' },
  ],
} };

test('simctl selection defaults to available iPhone and explicitly selects available iPad in an iOS runtime', () => {
  assert.equal(selectSimulator(inventory), phone);
  assert.equal(selectSimulator(inventory, 'ipad'), pad);
  assert.throws(() => selectSimulator(inventory, 'watch'), /iphone or ipad/);
  assert.throws(() => selectSimulator({}), /inventory is invalid/);
  assert.throws(() => selectSimulator({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-2': [{ name: 'iPad Pro', isAvailable: false, udid: pad }] } }, 'ipad'), /No available iPad/);
  assert.throws(() => selectSimulator({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-2': [{ name: 'iPad Pro', isAvailable: true, udid: 'invalid' }] } }, 'ipad'), /No available iPad/);
});

test('the actual selector CLI used by check-build returns the requested UUID and fails when that family is missing', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'reylumi-simctl-'));
  const file = path.join(directory, 'devices.json');
  try {
    writeFileSync(file, JSON.stringify(inventory));
    for (const [family, expected] of [['iphone', phone], ['ipad', pad]]) {
      const result = spawnSync(process.execPath, ['scripts/ios/select-simulator.mjs', file, family], { encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 0, result.stderr);assert.equal(result.stdout.trim(), expected);
    }
    writeFileSync(file, JSON.stringify({ devices: {} }));
    const missing = spawnSync(process.execPath, ['scripts/ios/select-simulator.mjs', file, 'ipad'], { encoding: 'utf8', windowsHide: true });
    assert.equal(missing.status, 1);assert.equal(missing.stdout, '');assert.match(missing.stderr, /No available iPad/);
    const source = readFileSync('ios/scripts/check-build.sh', 'utf8');
    assert.ok(source.includes('node ../scripts/ios/select-simulator.mjs "$task_run_dir/devices.json" "$task_simulator_family"'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
