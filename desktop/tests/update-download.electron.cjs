// Real Electron updater/download, with only installer process launch intercepted.
const { app } = require('electron');
const { NsisUpdater } = require('electron-updater');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
const { createServer } = require('node:http');
const yaml = require('js-yaml');
const scratch = fs.mkdtempSync(join(tmpdir(), 'kingpos-update-download-'));
app.setPath('userData', scratch);
app.getVersion = () => '0.5.1';
let badServer;
async function run() {
  await app.whenReady();
  console.log('Updater integration started.');
  const config = resolve(__dirname, '../dist-0.6.0/win-unpacked/resources/app-update.yml');
  const actual = yaml.load(fs.readFileSync(config, 'utf8'));
  assert.equal(actual.url, 'http://localhost:3107/desktop-updates/');
  assert.equal(actual.publisherName, undefined);
  const updater = new NsisUpdater();
  updater.updateConfigPath = config;
  updater.forceDevUpdateConfig = true;
  updater.autoDownload = false; updater.autoInstallOnAppQuit = false;
  updater.disableDifferentialDownload = true; updater.disableWebInstaller = true;
  Object.defineProperty(updater.app, 'baseCachePath', { value: scratch });
  updater.logger = { info() {}, warn() {}, error() {}, debug() {} };
  console.log('Checking local feed.');
  const result = await updater.checkForUpdates();
  assert.equal(result.isUpdateAvailable, true);
  assert.equal(result.updateInfo.version, '0.6.0');
  console.log('Downloading local installer.');
  const files = await updater.downloadUpdate();
  const digest = createHash('sha512').update(fs.readFileSync(files[0])).digest('base64');
  assert.equal(digest, result.updateInfo.files[0].sha512);
  console.log('PASS: real updater finds 0.6.0, downloads installer, verifies checksum without a certificate.');
  let launch;
  updater.spawnLog = async (exe, args) => { launch = { exe, args }; };
  assert.equal(updater.install(true, true), true);
  assert.equal(launch.exe, files[0]); assert.ok(launch.args.includes('--force-run')); assert.ok(launch.args.includes('/S'));
  console.log('PASS: installer handoff uses verified file and asks to reopen; process launch intercepted to preserve the installed app.');
  // A corrupt download must never become an installable update.
  badServer = createServer((req, res) => {
    if (req.url.startsWith('/latest.yml')) { res.end(yaml.dump({ version: '0.6.1', files: [{ url: 'bad.exe', sha512: Buffer.alloc(64).toString('base64'), size: 9 }], path: 'bad.exe', sha512: Buffer.alloc(64).toString('base64') })); }
    else res.end('bad bytes');
  });
  await new Promise(done => badServer.listen(0, '127.0.0.1', done));
  const bad = new NsisUpdater({ provider: 'generic', url: `http://127.0.0.1:${badServer.address().port}/` });
  bad.updateConfigPath = config; bad.setFeedURL({ provider: 'generic', url: `http://127.0.0.1:${badServer.address().port}/` }); bad.forceDevUpdateConfig = true; bad.autoDownload = false; bad.autoInstallOnAppQuit = false; bad.disableDifferentialDownload = true;
  bad.logger = updater.logger; Object.defineProperty(bad.app, 'baseCachePath', { value: join(scratch, 'bad') });
  await bad.checkForUpdates();
  await assert.rejects(bad.downloadUpdate(), /checksum/i);
  assert.equal(bad.installerPath, null);
  console.log('PASS: checksum mismatch rejects a corrupt update.');
}
run().then(() => finish(0), error => { console.error(error); finish(1); });
function finish(code) {
  badServer?.close();
  console.log('Test scratch:', scratch); // Remove after Electron releases its profile files.
  app.exit(code);
}
