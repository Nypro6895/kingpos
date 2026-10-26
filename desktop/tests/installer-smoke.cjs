'use strict';
// Explicit runtime check: uses a unique app ID, install directory and profile.
// Never points the installer at the real KingPOS installation or user data.
const { build, Platform, Arch } = require('electron-builder');
const { prepareInstallerTemplate } = require('../installer-template.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');

function run(file, args, timeout = 45000) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); reject(Error('Installer runtime timed out')); }, timeout);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); resolve(code); });
  });
}

async function main() {
  const stamp = Date.now();
  const name = `Reylumi Installer QA ${stamp}`;
  const root = path.resolve(__dirname, '../../artifacts/portable-installer-20261026', String(stamp));
  const payload = path.join(root, 'payload');
  const installed = path.join(root, 'installed');
  fs.mkdirSync(payload, { recursive: true });
  fs.mkdirSync(path.join(payload, 'resources'));
  fs.copyFileSync(path.join(process.env.SystemRoot, 'System32/ping.exe'), path.join(payload, `${name}.exe`));
  fs.writeFileSync(path.join(payload, 'payload.txt'), 'new payload');
  prepareInstallerTemplate(path.resolve(__dirname, '../build'));
  const files = await build({ targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), prepackaged: payload,
    config: {
      appId: `com.reylumi.installer.qa${stamp}`, productName: name,
      directories: { output: path.join(root, 'dist'), buildResources: path.resolve(__dirname, '../build') },
      artifactName: 'installer.exe', forceCodeSigning: false,
      win: { signExecutable: false },
      nsis: { include: path.resolve(__dirname, '../installer-check.nsh'), oneClick: false,
        perMachine: false, allowElevation: false, allowToChangeInstallationDirectory: true,
        createDesktopShortcut: false, createStartMenuShortcut: false, runAfterFinish: false,
        deleteAppDataOnUninstall: false }, publish: null,
    }, publish: 'never' });
  const installer = files.find(file => file.endsWith('installer.exe'));
  assert.ok(installer);
  assert.equal(await run(installer, ['/S', '/currentuser', `/D=${installed}`]), 0);
  assert.equal(fs.readFileSync(path.join(installed, 'payload.txt'), 'utf8'), 'new payload');
  console.log('PASS clean installation without WMI');

  const active = spawn(path.join(installed, `${name}.exe`), ['-t', '127.0.0.1'], { windowsHide: true });
  try {
    await new Promise((resolve, reject) => { active.once('spawn', resolve); active.once('error', reject); });
    assert.equal(await run(installer, ['/S', '/currentuser', `/D=${installed}`]), 2);
    assert.equal(fs.readFileSync(path.join(installed, 'payload.txt'), 'utf8'), 'new payload');
    console.log('PASS running application blocks silent replacement without terminating it');
  } finally {
    const stopped = new Promise(resolve => active.once('exit', resolve));
    active.kill();
    await stopped;
  }

  const profile = path.join(process.env.APPDATA, name);
  fs.mkdirSync(profile);
  fs.writeFileSync(path.join(profile, 'preserve.txt'), 'saved ticket fixture');
  const marker = path.join(root, 'legacy-uninstaller-was-called.txt');
  const legacy = path.join(installed, `Uninstall ${name}.exe`);
  const script = path.join(root, 'legacy.nsi');
  fs.writeFileSync(script, `OutFile "${legacy}"\nRequestExecutionLevel user\nSilentInstall silent\nSection\nFileOpen $0 "${marker}" w\nFileWrite $0 "legacy called"\nFileClose $0\nSleep 600000\nSectionEnd\n`);
  const compilerRoot = path.join(process.env.LOCALAPPDATA, 'electron-builder/Cache/nsis-3.0.4.1');
  function findCompiler(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isFile() && entry.name === 'makensis.exe') return file;
      if (entry.isDirectory()) { const found = findCompiler(file); if (found) return found; }
    }
  }
  execFileSync(findCompiler(compilerRoot), ['/V2', script], { windowsHide: true });
  fs.writeFileSync(path.join(installed, 'obsolete.txt'), 'old release file');
  assert.equal(await run(installer, ['/S', '/currentuser', `/D=${installed}`]), 0);
  assert.equal(fs.existsSync(marker), false, 'must not execute the old hanging uninstaller');
  assert.equal(fs.existsSync(path.join(installed, 'obsolete.txt')), false, 'old files must be removed');
  assert.equal(fs.readFileSync(path.join(profile, 'preserve.txt'), 'utf8'), 'saved ticket fixture');
  console.log('PASS legacy upgrade bypasses hanging uninstaller, removes old files and preserves profile');
  assert.equal(await run(path.join(installed, `Uninstall ${name}.exe`), ['/S', '/KEEP_APP_DATA', `/currentuser`, `_?=${installed}`]), 0);
  assert.equal(fs.readFileSync(path.join(profile, 'preserve.txt'), 'utf8'), 'saved ticket fixture');
  console.log('PASS repaired uninstaller without WMI; profile preserved');
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify({ passed: true, name, root, installer }, null, 2));
  console.log(root);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
