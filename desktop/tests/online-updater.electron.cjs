'use strict';
// Real Electron networking, metadata parser, checksum verification and NSIS
// handoff. Installer launch is intercepted to preserve the owner's real app.
const { app } = require('electron');
const { NsisUpdater } = require('electron-updater');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createServer } = require('node:http');
const ts = require('../../node_modules/typescript');
const yaml = require('js-yaml');
const root = path.resolve(__dirname, '../..');
const scratch = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'reylumi-online-update-'));
app.setPath('userData', scratch);
app.getVersion = () => '0.7.2';
let server;
async function main() {
  await app.whenReady();
  const installer = path.join(root, 'desktop/dist-updater-0.7.3/KingPOS Portable-Setup-0.7.3.exe');
  const bytes = fs.readFileSync(installer);
  const sha512 = createHash('sha512').update(bytes).digest('base64');
  const config = path.join(root, 'desktop/dist-updater-0.7.3/win-unpacked/resources/app-update.yml');
  assert.equal(yaml.load(fs.readFileSync(config, 'utf8')).url, 'https://reylumi.com/api/pos/windows-update/');
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'app/api/pos/windows-update/latest.yml/route.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const environment = { WINDOWS_POS_DOWNLOAD_SHA512: sha512, WINDOWS_POS_DOWNLOAD_SIZE: String(bytes.length) };
  vm.runInNewContext(code, { exports, Response, process: { env: environment },
    require: () => ({ getWindowsPosRelease: async () => ({ version: '0.7.3', edition: 'release', href: '/download/windows' }) }) });
  let corrupt = false, downloads = 0;
  server = createServer(async (request, response) => {
    if (request.url.startsWith('/latest.yml')) {
      const result = await exports.GET(); response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(await result.text());
    } else if (request.url === '/download/windows') {
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
  assert.equal(createHash('sha512').update(fs.readFileSync(files[0])).digest('base64'), sha512);
  assert.equal(downloads, 1);
  let launch;
  engine.spawnLog = async (file, args) => { launch = { file, args }; };
  assert.equal(engine.install(true, true), true);
  assert.equal(launch.file, files[0]); assert.ok(launch.args.includes('/S')); assert.ok(launch.args.includes('--force-run'));
  console.log('PASS real engine: discover only, download full installer, verify SHA512, silent install/reopen handoff');
  const cached = updater('valid'); await cached.checkForUpdates(); await cached.downloadUpdate();
  assert.equal(downloads, 1, 'verified cached download must be reused');
  console.log('PASS verified installer is reused after restart without downloading again');
  corrupt = true;
  const bad = updater('corrupt'); await bad.checkForUpdates();
  await assert.rejects(bad.downloadUpdate(), /checksum/i);
  assert.equal(bad.installerPath, null);
  console.log('PASS corrupt installer is rejected and cannot be installed');
  fs.writeFileSync(path.join(root, 'artifacts/portable-updater-20261026/native-update-result.json'), JSON.stringify({ passed: true,
    version: '0.7.3', bytes: bytes.length, sha512, sha256: createHash('sha256').update(bytes).digest('hex'),
    discoveryOnly: true, cacheReused: true, checksumRejected: true, installerHandoffVerified: true, processLaunchIntercepted: true }, null, 2));
}
main().then(() => finish(0), error => { console.error(error); finish(1); });
function finish(code) { server?.close(); app.exit(code); }
setTimeout(() => finish(1), 120000).unref();
