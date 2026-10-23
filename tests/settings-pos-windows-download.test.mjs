import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';

const root = process.cwd(), nativeRequire = createRequire(import.meta.url);
// Compile before changing cwd: esbuild's service must not hold a temporary
// fixture directory open on Windows after that fixture has finished.
const compiledSources = new Map([
  'lib/windows-pos-release.ts',
  'app/settings/direct-settings-actions.ts',
  'app/download/windows/route.ts',
].map(relativePath => [relativePath, transformSync(readFileSync(path.join(root, relativePath), 'utf8'), { loader: 'ts', format: 'cjs', target: 'node22' }).code]));
function loadSource(relativePath, dependencies) {
  const code = compiledSources.get(relativePath);
  assert.ok(code, `Source was not compiled: ${relativePath}`);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(dependencies, module, module.exports);
  return module.exports;
}

// Execute the real action and release resolver. Only account/DB dependencies
// are synthetic; the actual filesystem manifest and environment policy run.
function fixture(options = {}) {
  const temporaryRoot = realpathSync(tmpdir());
  const directory = mkdtempSync(path.join(temporaryRoot, 'settings-pos-download-'));
  const downloads = path.join(directory, 'public/desktop-updates');
  mkdirSync(downloads, { recursive: true });
  const version = options.version ?? '1.2.3';
  const filename = options.filename ?? `KingPOS Portable Test-Setup-${version}.exe`;
  writeFileSync(path.join(downloads, 'latest.yml'), `version: ${version}\npath: ${filename}\n`);
  if (options.artifact !== false) writeFileSync(path.join(downloads, filename), 'Synthetic test file; never executed.');
  const previousDirectory = process.cwd();
  const envNames = ['NODE_ENV', 'WINDOWS_POS_DOWNLOAD_URL', 'WINDOWS_POS_DOWNLOAD_VERSION'];
  const previousEnvironment = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  process.env.NODE_ENV = options.production === false ? 'development' : 'production';
  for (const name of envNames.slice(1)) delete process.env[name];
  if (options.url !== undefined) process.env.WINDOWS_POS_DOWNLOAD_URL = options.url;
  if (options.releaseVersion !== undefined) process.env.WINDOWS_POS_DOWNLOAD_VERSION = options.releaseVersion;
  process.chdir(directory);
  function close() {
    process.chdir(previousDirectory);
    for (const name of envNames) {
      if (previousEnvironment[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnvironment[name];
    }
    const target = realpathSync(directory);
    assert.ok(target.startsWith(temporaryRoot + path.sep));
    assert.ok(path.basename(target).startsWith('settings-pos-download-'));
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  try {
  const reads = [], context = { user: options.anonymous ? null : { id: 'qa-user' }, currentSalon: { id: 'qa-salon', name: 'QA', status: 'active' }, currentMembership: {}, currentAccount: { id: 'qa-account' } };
  const db = { from(table) { reads.push(['table', table]); assert.equal(table, 'pos_settings'); return { select(columns) { assert.equal(columns, '*'); return this; }, eq(column, value) { assert.equal(column, 'salon_id'); assert.equal(value, 'qa-salon'); return this; }, async maybeSingle() { return { data: { qa: true }, error: options.dbError ? { message: 'Synthetic settings failure' } : null }; } }; } };
  const stubs = {
    getCurrentBusinessContext: async () => context,
    isSalonManageContext: () => true, isOwnerMembership: () => true,
    createAuthenticatedSupabaseServerClient: async () => db,
    withSettingsTarget: async (target, operation) => { reads.push(['target', target]); return operation(); },
    requirePermission: async (permission, actualContext) => { reads.push(['required', permission]); assert.equal(permission, 'tickets.view'); assert.equal(actualContext, context); if (options.denied) throw Error('Synthetic permission denied'); },
    hasPermission: async permission => { reads.push(['permission', permission]); return false; },
    getCurrentSalonPosSettings: async () => { reads.push(['pos-settings']); return { qa: 'view' }; },
    getCurrentSalonPortablePosAccessState: async () => { reads.push(['portable-access']); return { keys: [] }; },
  };
  const releaseModule = loadSource('lib/windows-pos-release.ts', nativeRequire);
  const dependencies = name => {
    if (name === '@/lib/windows-pos-release') return releaseModule;
    if (name.startsWith('node:')) return nativeRequire(name);
    return new Proxy({}, { get: (_, exportName) => exportName === '__esModule' ? true : stubs[exportName] ?? (() => { throw Error(`Unexpected dependency: ${name}.${String(exportName)}`); }) });
  };
  const action = loadSource('app/settings/direct-settings-actions.ts', dependencies);
  const publicRoute = loadSource('app/download/windows/route.ts', dependencies);
    return { reads, load: () => action.loadDirectSettings('pos-display', 'qa-salon'), release: releaseModule.getWindowsPosRelease, publicDownload: publicRoute.GET, close };
  } catch (error) {
    close();
    throw error;
  }
}
async function using(options, operation) { const f = fixture(options); try { await operation(f); } finally { f.close(); } }

test('Settings POS and public download select configured release over bundled old Test manifest', async () => {
  const url = 'https://example.invalid/releases/KingPOS.Portable-Setup-9.8.7.exe';
  await using({ url, releaseVersion: '9.8.7' }, async f => {
    const data = await f.load(), response = await f.publicDownload();
    assert.equal(data.installer, url);
    assert.equal(data.installer, (await f.release()).href);
    assert.equal(response.status, 307); assert.equal(response.headers.get('location'), data.installer);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(data.canManage, false); assert.equal(data.canManagePortable, false);
    assert.deepEqual(f.reads.find(row => row[0] === 'target'), ['target', 'qa-salon']);
    assert.ok(f.reads.some(row => row[0] === 'required' && row[1] === 'tickets.view'));
  });
});

test('production without an official release does not offer the bundled Test installer', async () => {
  await using({}, async f => { assert.equal((await f.load()).installer, null); assert.equal((await f.publicDownload()).status, 503); });
});

for (const [name, url, releaseVersion] of [
  ['HTTP origin', 'http://example.test/pos.exe', '9.8.7'],
  ['credentials in URL', 'https://qa:invalid@example.test/pos.exe', '9.8.7'],
  ['missing version', 'https://example.test/pos.exe', undefined],
  ['malformed version', 'https://example.test/pos.exe', 'latest'],
]) test(`invalid configured release fails closed: ${name}`, async () => {
  // A usable production manifest exists, so null proves an invalid override
  // does not silently fall back to another release.
  await using({ url, releaseVersion, version: '0.8.2', filename: 'KingPOS Portable-Setup-0.8.2.exe' }, async f => { assert.equal((await f.load()).installer, null); assert.equal(await f.release(), null); });
});

test('development keeps an existing local Test installer available', async () => {
  await using({ production: false }, async f => { assert.equal((await f.load()).installer, '/desktop-updates/KingPOS%20Portable%20Test-Setup-1.2.3.exe'); });
});

test('manifest release filename is respected instead of inventing a Test filename', async () => {
  await using({ version: '0.8.2', filename: 'KingPOS Portable-Setup-0.8.2.exe' }, async f => { assert.equal((await f.load()).installer, '/desktop-updates/KingPOS%20Portable-Setup-0.8.2.exe'); });
});

test('a manifest without an existing artifact does not produce a dead download link', async () => {
  await using({ production: false, artifact: false }, async f => { assert.equal((await f.load()).installer, null); });
});

test('unauthenticated Settings reads still fail before POS data lookup', async () => {
  await using({ anonymous: true }, async f => { await assert.rejects(f.load(), /Choose a salon/); assert.equal(f.reads.some(row => ['table', 'pos-settings', 'portable-access'].includes(row[0])), false); });
});

test('tickets.view denial still prevents POS data lookup', async () => {
  await using({ denied: true }, async f => { await assert.rejects(f.load(), /permission denied/); assert.equal(f.reads.some(row => ['table', 'pos-settings', 'portable-access'].includes(row[0])), false); });
});

test('settings database failure is still surfaced, not hidden as download unavailability', async () => {
  await using({ dbError: true }, async f => { await assert.rejects(f.load(), /Synthetic settings failure/); });
});
