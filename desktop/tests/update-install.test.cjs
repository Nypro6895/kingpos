const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const source = readFileSync(join(__dirname, '../main.cjs'), 'utf8').split('async function installUpdate(')[1];
async function attempt({ pending = false, busy = false, failedSave = false, failedBackup = false, scheduled = true } = {}) {
  let installed = false, backedUp = false, cleared = false;
  const document = { body: { inert: false }, querySelector: () => null };
  const window = { __kingposLastInput: Date.now() - 120000, dispatchEvent(e) { e.detail.saved = !failedSave; e.detail.busy = busy; } };
  const context = vm.createContext({ installing: false, updateReady: true, updateMessage: '',
    updater: { quitAndInstall(silent, forceRun) { assert.equal(silent, true); assert.equal(forceRun, true); installed = true; } },
    vault: { pending: () => pending, async backup() { if (failedBackup) throw Error('disk full'); backedUp = true; } },
    updatePlan: { set() { cleared = true; } },
    win: { isDestroyed: () => false, webContents: { async executeJavaScript(code) { return vm.runInNewContext(code, { document, window, Date, CustomEvent: class { constructor(_, props) { this.detail = props.detail; } } }); }, session: { cookies: { async flushStore() {} }, flushStorageData() {} } } },
  });
  vm.runInContext('async function installUpdate(' + source, context);
  await context.installUpdate(true, scheduled);
  assert.equal(document.body.inert, false);
  return { installed, backedUp, cleared };
}
test('scheduled update waits for ticket work, upload, and successful device save', async () => {
  for (const input of [{ pending: true }, { busy: true }, { failedSave: true }, { failedBackup: true }]) {
    const value = await attempt(input); assert.equal(value.installed, false); assert.equal(value.cleared, false);
  }
});
test('ready scheduled update backs up before install; explicit Now can keep a persisted draft', async () => {
  assert.deepEqual(await attempt(), { installed: true, backedUp: true, cleared: true });
  assert.deepEqual(await attempt({ busy: true, scheduled: false }), { installed: true, backedUp: true, cleared: true });
});

test('Update now refuses pending uploads or failed saves and backups', async () => {
  for (const input of [{ pending: true }, { failedSave: true }, { failedBackup: true }]) {
    assert.equal((await attempt({ ...input, scheduled: false })).installed, false);
  }
});
