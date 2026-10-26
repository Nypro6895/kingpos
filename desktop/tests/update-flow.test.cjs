const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const source = readFileSync(join(__dirname, '../main.cjs'), 'utf8').split('function updateState()')[1];

function host({ pending = false, downloadFails = false, checkFails = false, replies = [], channel = 'online', publisher } = {}) {
  const effects = [], dialogs = [], timers = [];
  const engine = new EventEmitter();
  Object.assign(engine, {
    setFeedURL(value) { effects.push(['feed', value.url]); },
    async checkForUpdates() { effects.push(['check']); if (checkFails) throw Error('offline'); return { isUpdateAvailable: true, updateInfo: { version: '0.7.4' } }; },
    async downloadUpdate() { effects.push(['download']); engine.emit('download-progress', { percent: 46.2 }); if (downloadFails) throw Error('checksum mismatch'); engine.emit('update-downloaded'); },
    quitAndInstall(silent, reopen) { effects.push(['install', silent, reopen]); },
  });
  const context = vm.createContext({
    updater: undefined, updateReady: false, installing: false, updatePlan: { set() {} },
    updateVersion: '', updatePhase: 'unavailable', updateMessage: '', checkingUpdate: false,
    updateCheckPromise: undefined, updateDownloadPromise: undefined, installRequest: undefined, updateProgress: 0,
    config: { channel, origin: 'https://reylumi.com', updates: channel === 'release', publisher },
    app: { isPackaged: true, getVersion: () => '0.7.3' },
    require: name => { assert.equal(name, 'electron-updater'); return { autoUpdater: engine }; },
    setInterval(callback, delay) { timers.push({ callback, delay }); return { unref() {} }; },
    dialog: { async showMessageBox(_window, options) { dialogs.push(options); return { response: replies.shift() ?? 0 }; } },
    vault: { pending: () => pending, async backup() { effects.push(['backup']); } },
    win: { isDestroyed: () => false, webContents: {
      async executeJavaScript(code) { effects.push([code.includes('desktop-flush') ? 'flush' : 'unfreeze']); return true; },
      session: { cookies: { async flushStore() { effects.push(['cookies']); } }, flushStorageData() { effects.push(['storage']); } },
    } },
  });
  vm.runInContext('function updateState()' + source, context);
  return { context, effects, dialogs, timers, engine, count: name => effects.filter(e => e[0] === name).length };
}

test('Online automatically discovers updates without downloading or installing; manual Later keeps current version', async () => {
  const h = host(); h.context.setupUpdater(); await h.context.checkUpdate(false);
  assert.equal(h.context.updatePhase, 'available'); assert.equal(h.context.updateVersion, '0.7.4');
  assert.equal(h.count('check'), 1); assert.equal(h.count('download'), 0); assert.equal(h.count('install'), 0);
  assert.equal(h.engine.autoDownload, false); assert.equal(h.engine.autoInstallOnAppQuit, false);
  assert.equal(h.timers[0].delay, 30 * 60 * 1000);
  assert.deepEqual(h.effects[0], ['feed', 'https://reylumi.com/api/pos/windows-update/']);
  await h.context.checkUpdate(true); assert.equal(h.count('download'), 0);
  assert.match(h.dialogs[0].buttons[0], /Keep current/);
});

test('Install before a download discovers, downloads once, flushes, backs up and hands off for automatic installation/reopen', async () => {
  const h = host({ replies: [1] }); h.context.setupUpdater();
  await Promise.all([h.context.requestUpdateInstall(), h.context.requestUpdateInstall()]);
  assert.equal(h.count('download'), 1); assert.equal(h.count('install'), 1);
  const order = h.effects.map(e => e[0]);
  assert.ok(order.indexOf('download') < order.indexOf('flush'));
  assert.ok(order.indexOf('flush') < order.indexOf('backup'));
  assert.ok(order.indexOf('backup') < order.indexOf('install'));
  assert.deepEqual(h.effects.find(e => e[0] === 'install'), ['install', true, true]);
});

test('Download-only action leaves current app open; downloaded installer can be installed without another download', async () => {
  const h = host({ replies: [1] }); h.context.setupUpdater(); await h.context.checkUpdate(true);
  assert.equal(h.count('download'), 1); assert.equal(h.count('install'), 0);
  assert.equal(h.context.updateState().progress, 100); assert.equal(h.context.updatePhase, 'ready');
  await h.context.requestUpdateInstall(true);
  assert.equal(h.count('download'), 1); assert.equal(h.count('install'), 1);
});

test('failed or corrupt download never installs; pending uploads block install and backup', async () => {
  const bad = host({ downloadFails: true }); bad.context.setupUpdater(); await bad.context.requestUpdateInstall(true);
  assert.equal(bad.context.updateReady, false); assert.equal(bad.count('install'), 0); assert.equal(bad.count('backup'), 0);
  assert.match(bad.context.updateMessage, /current version has been kept/);
  const pending = host({ pending: true }); pending.context.setupUpdater(); await pending.context.requestUpdateInstall(true);
  assert.equal(pending.count('install'), 0); assert.equal(pending.count('backup'), 0);
  assert.match(pending.context.updateMessage, /Uploading|uploading/);
});

test('discovery failure is shown and never reported as up-to-date; signed release still requires a publisher', async () => {
  const h = host({ checkFails: true }); h.context.setupUpdater(); await h.context.checkUpdate(true);
  assert.match(h.dialogs[0].message, /Could not check/); assert.equal(h.count('download'), 0);
  const signed = host({ channel: 'release' }); signed.context.setupUpdater(); assert.equal(signed.context.updater, undefined);
});
