'use strict';
// Real Electron networking, metadata parser, checksum verification and NSIS
// handoff. Installer launch is intercepted to preserve the owner's real app.
const { app, BrowserWindow } = require('electron');
const { NsisUpdater } = require('electron-updater');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createServer } = require('node:http');
const ts = require('../../node_modules/typescript');
const yaml = require('js-yaml');
const { prepareUpdateInstaller, launchUpdateInstaller } = require('../update-installer.cjs');
const root = path.resolve(__dirname, '../..');
const scratch = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'reylumi-online-update-'));
app.setPath('userData', scratch);
app.getVersion = () => '0.7.2';
app.on('window-all-closed', () => {}); // Continue checksum tests after closing the isolated DOM fixture.
let server;
async function main() {
  await app.whenReady();
  const version=process.env.KINGPOS_DESKTOP_TEST_VERSION||'0.7.3';
  const buildDir=process.env.KINGPOS_DESKTOP_TEST_BUILD_DIR||path.join(root,'desktop/dist-updater-0.7.3');
  const evidenceDir=process.env.KINGPOS_DESKTOP_TEST_EVIDENCE_DIR||path.join(root,'artifacts/portable-updater-20261026');fs.mkdirSync(evidenceDir,{recursive:true});
  const installer = path.join(buildDir, `KingPOS Portable-Setup-${version}.exe`);
  const bytes = fs.readFileSync(installer);
  const sha512 = createHash('sha512').update(bytes).digest('base64');
  const config = path.join(buildDir, 'win-unpacked/resources/app-update.yml');
  assert.equal(yaml.load(fs.readFileSync(config, 'utf8')).url, 'https://reylumi.com/api/pos/windows-update/');
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'app/api/pos/windows-update/latest.yml/route.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const environment = { WINDOWS_POS_DOWNLOAD_SHA512: sha512, WINDOWS_POS_DOWNLOAD_SIZE: String(bytes.length) };
  vm.runInNewContext(code, { exports, Response, process: { env: environment },
    require: () => ({ getWindowsPosRelease: async () => ({ version, edition: 'release', href: '/download/windows' }) }) });
  let corrupt = false, downloads = 0;
  server = createServer(async (request, response) => {
    if (request.url.startsWith('/latest.yml')) {
      const result = await exports.GET(); response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(await result.text());
    } else if (request.url === '/download/windows.exe') {
      downloads++; response.setHeader('Content-Type', 'application/octet-stream');
      if (corrupt) response.end('MZ-corrupt');
      else { response.setHeader('Content-Length', bytes.length); fs.createReadStream(installer).pipe(response); }
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  function updater(cache) {
    const engine = new NsisUpdater();
    engine.updateConfigPath = config; engine.forceDevUpdateConfig = true;
    engine.setFeedURL({ provider: 'generic', url: `http://127.0.0.1:${server.address().port}/` });
    engine.autoDownload = false; engine.autoInstallOnAppQuit = false;
    engine.disableDifferentialDownload = true; engine.disableWebInstaller = true;
    Object.defineProperty(engine.app, 'baseCachePath', { value: path.join(scratch, cache) });
    engine.logger = { info() {}, warn() {}, error() {}, debug() {} };
    return engine;
  }
  const engine = updater('valid');
  const result = await engine.checkForUpdates();
  assert.equal(result.isUpdateAvailable, true); assert.equal(downloads, 0);
  const files = await engine.downloadUpdate();
  assert.ok(files[0].endsWith('.exe'), 'Windows cached installer must have an executable extension');
  assert.equal(createHash('sha512').update(fs.readFileSync(files[0])).digest('base64'), sha512);
  assert.equal(downloads, 1);
  let launch;
  engine.spawnLog = async (file, args) => { launch = { file, args }; };
  await prepareUpdateInstaller(engine);
  await launchUpdateInstaller(engine);
  assert.equal(launch.file, files[0]); assert.ok(launch.args.includes('/S')); assert.ok(launch.args.includes('--force-run'));
  console.log('PASS real engine: discover only, download full installer, verify SHA512, silent install/reopen handoff');
  const cached = updater('valid'); await cached.checkForUpdates(); await cached.downloadUpdate();
  assert.equal(downloads, 1, 'verified cached download must be reused');
  console.log('PASS verified installer is reused after restart without downloading again');
  // Simulate the real old feed cache name, including persisted cache metadata.
  const helper = cached.downloadedUpdateHelper;
  const oldCache = path.join(path.dirname(cached.installerPath), 'windows');
  fs.copyFileSync(cached.installerPath, oldCache);
  await helper.setDownloadedFile(oldCache, helper.packageFile, helper.versionInfo, helper.fileInfo, 'windows', true);
  await prepareUpdateInstaller(cached);
  assert.ok(cached.installerPath.endsWith('.exe'));
  assert.ok(JSON.parse(fs.readFileSync(helper.getUpdateInfoFile(), 'utf8')).fileName.endsWith('.exe'));
  console.log('PASS real legacy cache is repaired with verified bytes and executable persisted metadata');

  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await window.loadURL('data:text/html,' + encodeURIComponent('<input value="QA draft"><dialog open>Business dialog</dialog><script>window.qaBusy=false;window.qaSaved=true;window.addEventListener("kingpos:desktop-flush",event=>{event.detail.saved=window.qaSaved;event.detail.busy=true;event.detail.operationBusy=window.qaBusy;});</script>'));
    let quits = 0, backups = 0, launches = 0, failBackup = false, pending = false;
    cached.spawnLog = async () => { launches++; };
    const source = fs.readFileSync(path.join(root, 'desktop/main.cjs'), 'utf8').split('function updateState()')[1];
    const context = vm.createContext({
      updater: cached, updateReady: true, installing: false, updateVersion: version, updatePhase: 'ready', updateMessage: '', updateProgress: 100,
      checkingUpdate: false, updateCheckPromise: undefined, updateDownloadPromise: undefined, installRequest: undefined,
      updatePlan: { set() {} }, win: window, prepareUpdateInstaller, launchUpdateInstaller,
      app: { getVersion: () => '0.7.2', quit() { quits++; } },
      vault: { pending: () => pending, async backup() { if (failBackup) throw Error('Fixture disk error'); backups++; } },
    });
    vm.runInContext('function updateState()' + source, context);
    await context.requestUpdateInstall(true);
    assert.equal(context.updatePhase, 'blocked'); assert.match(context.updateMessage, /dialog/); assert.equal(quits, 0);
    await window.webContents.executeJavaScript('document.querySelector("dialog").className="portable-device-settings";window.qaBusy=true;');
    await context.requestUpdateInstall(true);
    assert.match(context.updateMessage, /operation/); assert.equal(backups, 0);
    await window.webContents.executeJavaScript('window.qaBusy=false;window.qaSaved=false;');
    await context.requestUpdateInstall(true);
    assert.match(context.updateMessage, /saving/); assert.equal(quits, 0);
    await window.webContents.executeJavaScript('window.qaSaved=true;');
    pending = true; await context.requestUpdateInstall(true);
    assert.match(context.updateMessage, /uploading/); assert.equal(quits, 0); pending = false;
    failBackup = true; await context.requestUpdateInstall(true);
    assert.equal(context.updatePhase, 'error'); assert.equal(await window.webContents.executeJavaScript('document.body.inert'), false);
    failBackup = false; await context.requestUpdateInstall(true);
    assert.equal(context.updatePhase, 'installing'); assert.equal(quits, 1); assert.equal(launches, 1); assert.equal(backups, 1);
    assert.equal(await window.webContents.executeJavaScript('document.querySelector("input").value'), 'QA draft');
    console.log('PASS real Electron DOM + native flow: business dialog, busy operation, unsaved draft, pending upload, failed backup, retry, one install and one restart handoff');
  } finally { window.destroy(); }
  corrupt = true;
  const bad = updater('corrupt'); await bad.checkForUpdates();
  await assert.rejects(bad.downloadUpdate(), /checksum/i);
  assert.equal(bad.installerPath, null);
  console.log('PASS corrupt installer is rejected and cannot be installed');
  fs.writeFileSync(path.join(evidenceDir,'native-update-result.json'), JSON.stringify({ passed: true,
    version, bytes: bytes.length, sha512, sha256: createHash('sha256').update(bytes).digest('hex'),
    discoveryOnly: true, cacheReused: true, legacyCacheRepaired: true, realDomReadiness: true, failedBackupRecovered: true,
    checksumRejected: true, installerHandoffVerified: true, processLaunchIntercepted: true }, null, 2));
}
main().then(() => finish(0), error => { console.error(error); finish(1); });
function finish(code) { server?.close(); app.exit(code); }
setTimeout(() => finish(1), 120000).unref();
