'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, readFileSync, rmSync, copyFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { prepareUpdateInstaller, launchUpdateInstaller } = require('../update-installer.cjs');

test('old extensionless cache is preserved, verified and repaired to executable metadata', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'kingpos-updater-repair-'));
  try {
    const file = join(directory, 'windows'), bytes = Buffer.from('MZ cached installer fixture');
    writeFileSync(file, bytes);
    const helper = { file, downloadedFileInfo: { sha512: createHash('sha512').update(bytes).digest('base64') },
      async setDownloadedFile(next, _package, _version, _info, name, persist) { this.file = next; this.name = name; this.persist = persist; } };
    const engine = { downloadedUpdateHelper: helper, get installerPath() { return helper.file; } };
    const prepared = await prepareUpdateInstaller(engine);
    assert.match(prepared, /\.exe$/); assert.equal(engine.installerPath, prepared);
    assert.deepEqual(readFileSync(prepared), bytes); assert.deepEqual(readFileSync(file), bytes);
    assert.equal(helper.persist, true); assert.match(helper.name, /\.exe$/);
    writeFileSync(prepared, 'tampered');
    await assert.rejects(prepareUpdateInstaller(engine), /could not be verified/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('Windows reproduces extensionless PE failure and launches the identical .exe bytes', { skip: process.platform !== 'win32' }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'kingpos-updater-pe-'));
  try {
    const source = join(process.env.SystemRoot, 'System32', 'where.exe');
    const withoutExtension = join(directory, 'windows'), executable = withoutExtension + '.exe';
    copyFileSync(source, withoutExtension);
    assert.equal(spawnSync(withoutExtension, ['/?'], { windowsHide: true, timeout: 5000 }).error?.code, 'ENOENT');
    copyFileSync(source, executable);
    const result = spawnSync(executable, ['/?'], { windowsHide: true, timeout: 5000 });
    assert.equal(result.error, undefined); assert.equal(result.status, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function engine({ denied = false, elevationFails = false } = {}) {
  const calls = [];
  return { calls, quitAndInstallCalled: false,
    async spawnLog(file, args) {
      calls.push({ file, args });
      if ((file === 'installer.exe' && denied) || elevationFails) throw Object.assign(Error('Permission denied'), { code: 'EACCES' });
      return true;
    },
    install(silent, reopen) {
      assert.equal(silent, true); assert.equal(reopen, true); this.quitAndInstallCalled = true;
      this.spawnLog('installer.exe', ['/S', '--force-run']).catch(error => {
        if (error.code === 'EACCES') this.spawnLog('elevate.exe', ['installer.exe', '/S', '--force-run']).catch(() => {});
      });
      return true;
    },
  };
}

test('installer handoff awaits process spawn and preserves ordinary Windows elevation', async () => {
  const direct = engine(); const original = direct.spawnLog;
  await launchUpdateInstaller(direct); assert.equal(direct.calls.length, 1); assert.equal(direct.spawnLog, original);
  const elevated = engine({ denied: true }); await launchUpdateInstaller(elevated);
  assert.deepEqual(elevated.calls.map(call => call.file), ['installer.exe', 'elevate.exe']);
});

test('denied installer launch resets engine guard so the current app can retry', async () => {
  const refused = engine({ denied: true, elevationFails: true });
  await assert.rejects(launchUpdateInstaller(refused), /Permission denied/);
  assert.equal(refused.quitAndInstallCalled, false);
  refused.spawnLog = async () => true;
  await launchUpdateInstaller(refused);
});
