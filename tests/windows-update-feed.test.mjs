import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const digest = Buffer.alloc(64, 8).toString('base64');
function feed(env = {}, release = { version: '0.7.3', edition: 'release', href: '/download/windows' }) {
  const exports = {};
  const source = ts.transpileModule(readFileSync('app/api/pos/windows-update/latest.yml/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, process: { env }, Response,
    require: () => ({ getWindowsPosRelease: async () => release }) });
  return exports.GET();
}

test('feed describes only a checksum-pinned release at the Reylumi download path', async () => {
  const response = await feed({ WINDOWS_POS_DOWNLOAD_SHA512: digest, WINDOWS_POS_DOWNLOAD_SIZE: '111790179' });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json();
  assert.equal(result.version, '0.7.3'); assert.equal(result.files[0].url, '/download/windows');
  assert.equal(result.files[0].sha512, digest); assert.equal(result.files[0].size, 111790179);
  assert.doesNotMatch(JSON.stringify(result), /github|nypro/i);
});

test('unpublished, local-test, missing-hash and malformed release metadata fail closed', async () => {
  for (const env of [{}, { WINDOWS_POS_DOWNLOAD_SHA512: 'bad', WINDOWS_POS_DOWNLOAD_SIZE: '111' },
    { WINDOWS_POS_DOWNLOAD_SHA512: digest, WINDOWS_POS_DOWNLOAD_SIZE: '0' },
    { WINDOWS_POS_DOWNLOAD_SHA512: digest, WINDOWS_POS_DOWNLOAD_SIZE: '999999999999' }]) assert.equal((await feed(env)).status, 503);
  const env = { WINDOWS_POS_DOWNLOAD_SHA512: digest, WINDOWS_POS_DOWNLOAD_SIZE: '111' };
  assert.equal((await feed(env, null)).status, 503);
  assert.equal((await feed(env, { version: '0.7.3', edition: 'test' })).status, 503);
});
