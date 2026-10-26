import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function route(fetcher, source = { version: '0.7.2', href: 'https://github.com/private-owner/app/releases/download/v0.7.2/setup.exe' }) {
  const exports = {};
  const code = ts.transpileModule(readFileSync('app/download/windows/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: () => ({ getWindowsPosDownloadSource: async () => source }),
    Response, Headers, URL, fetch: fetcher });
  return exports;
}
const request = (headers = {}) => new Request('https://reylumi.com/download/windows', { headers });

test('streams the complete installer without exposing storage headers', async () => {
  const binary = new Uint8Array(6 * 1024 * 1024); binary[0] = 77; binary[1] = 90;
  const api = route(async (url, options) => {
    assert.equal(url.hostname, 'github.com'); assert.equal(options.redirect, 'follow');
    assert.equal(options.headers.get('cookie'), null);
    return new Response(binary, { headers: { 'Content-Type': 'application/octet-stream',
      Location: 'https://github.com/private-owner/app', 'Content-Disposition': 'attachment; filename="owner.exe"',
      'Content-Length': String(binary.length), 'Set-Cookie': 'private=1' } });
  });
  const response = await api.GET(request({ cookie: 'session=private' }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.match(response.headers.get('content-disposition'), /KingPOS-Portable-Setup-0.7.2.exe/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), binary);
});

test('supports range downloads and HEAD while keeping responses on Reylumi', async () => {
  const api = route(async (_url, options) => {
    assert.equal(options.headers.get('range'), 'bytes=0-1');
    return new Response(options.method === 'HEAD' ? null : 'MZ', { status: 206,
      headers: { 'content-range': 'bytes 0-1/100', 'content-length': '2', 'accept-ranges': 'bytes' } });
  });
  const response = await api.GET(request({ range: 'bytes=0-1' }));
  assert.equal(response.status, 206); assert.equal(await response.text(), 'MZ');
  assert.equal(response.headers.get('content-range'), 'bytes 0-1/100');
  assert.equal(await (await api.HEAD(request({ range: 'bytes=0-1' }))).text(), '');
});

test('storage failures, error documents, and recursive configuration never leak source URLs', async () => {
  for (const fetcher of [async () => { throw Error('private-owner'); },
    async () => new Response('private-owner', { status: 404 }),
    async () => new Response('private-owner', { headers: { 'content-type': 'text/html' } })]) {
    const response = await route(fetcher).GET(request());
    assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private-owner/);
    assert.equal(response.headers.get('location'), null);
  }
  const recursive = route(() => { throw Error('must not fetch'); }, { version: '0.7.2', href: '/download/windows' });
  assert.equal((await recursive.GET(request())).status, 503);
  assert.equal((await route(() => {}, null).GET(request())).status, 503);
});
