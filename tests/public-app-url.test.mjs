import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, env, dependencies = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, require: name => dependencies[name], process: { env, cwd: () => '.' }, URL });
  return exports;
}

test('production falls back to the public website for missing, invalid or local origins', () => {
  for (const value of [undefined, 'bad', 'http://localhost:3000', 'https://localhost', 'https://user:secret@example.com']) {
    const api = load('lib/public-app-url.ts', { NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: value });
    assert.equal(api.getPublicAppOrigin(), 'https://reylumi.com');
    assert.equal(api.normalizePublicDownloadUrl('http://localhost:3107/book/123?source=qr'), 'https://reylumi.com/book/123?source=qr');
    assert.equal(api.normalizePublicDownloadUrl('https://store.example/app'), 'https://store.example/app');
  }
});

test('configured origin strips paths while local development remains supported', () => {
  assert.equal(load('lib/public-app-url.ts', { NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'https://www.reylumi.com/path' }).getPublicAppOrigin(), 'https://www.reylumi.com');
  assert.equal(load('lib/public-app-url.ts', { NODE_ENV: 'development', NEXT_PUBLIC_APP_URL: 'http://localhost:3000' }).getPublicAppOrigin(), 'http://localhost:3000');
});

test('production hides local installers and accepts configured HTTPS releases', async () => {
  const dependencies = {
    'node:fs/promises': { readFile: async () => 'version: 0.6.4\npath: KingPOS Portable Test-Setup-0.6.4.exe\n', access: async () => {} },
    'node:path': { default: { join: (...parts) => parts.join('/') } },
  };
  assert.equal(await load('lib/windows-pos-release.ts', { NODE_ENV: 'production' }, dependencies).getWindowsPosRelease(), null);
  const release = await load('lib/windows-pos-release.ts', { NODE_ENV: 'production', WINDOWS_POS_DOWNLOAD_URL: 'https://downloads.example/setup.exe', WINDOWS_POS_DOWNLOAD_VERSION: '1.0.0' }, dependencies).getWindowsPosRelease();
  assert.equal(release.edition, 'release');
  assert.equal(release.href, 'https://downloads.example/setup.exe');
  assert.equal(await load('lib/windows-pos-release.ts', { WINDOWS_POS_DOWNLOAD_URL: 'http://localhost/setup.exe', WINDOWS_POS_DOWNLOAD_VERSION: '1.0.0' }, dependencies).getWindowsPosRelease(), null);
});
