import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function routes(source = { href: 'https://storage.example/installer.exe', version: '0.7.6' }) {
  const exports = {}, calls = [];
  const compile = file => ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compile('app/download/windows/route.ts'), { exports, Response, Headers, URL,
    require: () => ({ getWindowsPosDownloadSource: async () => source }),
    fetch: async (url, options) => {
      calls.push({ url: url.href, options });
      return new Response(options.method === 'HEAD' ? null : 'MZ', { status: 206, headers: {
        'Content-Type': 'application/octet-stream', 'Content-Length': '2', 'Content-Range': 'bytes 0-1/111709690',
        'Accept-Ranges': 'bytes', Location: 'https://storage.example/private', 'Set-Cookie': 'private=fixture',
      } });
    },
  });
  const alias = {};
  vm.runInNewContext(compile('app/download/windows.exe/route.ts'), { exports: alias, require: () => exports });
  return { alias, original: exports, calls };
}

test('executable alias streams the same pinned installer, supports HEAD/range and hides storage headers', async () => {
  const { alias, calls } = routes();
  const response = await alias.GET(new Request('https://reylumi.com/download/windows.exe', { headers: { Range: 'bytes=0-1' } }));
  assert.equal(response.status, 206); assert.equal(await response.text(), 'MZ');
  assert.equal(response.headers.get('Content-Disposition'), 'attachment; filename="KingPOS-Portable-Setup-0.7.6.exe"');
  assert.equal(response.headers.get('Location'), null); assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(calls[0].options.headers.get('Range'), 'bytes=0-1');
  const head = await alias.HEAD(new Request('https://reylumi.com/download/windows.exe'));
  assert.equal(head.status, 206); assert.equal(await head.text(), ''); assert.equal(calls[1].options.method, 'HEAD');
});

test('either branded alias as its own upstream fails closed before fetching recursively', async () => {
  for (const href of ['https://reylumi.com/download/windows', 'https://reylumi.com/download/windows.exe']) {
    const { alias, calls } = routes({ href, version: '0.7.6' });
    const response = await alias.GET(new Request('https://reylumi.com/download/windows.exe'));
    assert.equal(response.status, 503); assert.equal(calls.length, 0);
  }
});
