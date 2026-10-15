import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(file, modules) {
  const exports = {};
  const js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', js)(name => modules[name] ?? {}, exports);
  return exports;
}
const helpers = load('lib/experience-live-resource-server.ts', { 'node:crypto': { createHash } });
function fixture({ unavailable = false, fence = async () => {} } = {}) {
  let reads = 0;
  const state = { catalog: { price: 590 }, installed: false, pluginLoadError: '' };
  const { GET } = load('app/api/experience/market/route.ts', {
    'next/server': { connection: fence },
    'next/headers': { headers: async () => new Headers(unavailable ? { 'x-reylumi-auth-unavailable': '1' } : {}) },
    '@/lib/request-business-context': { getRequestBusinessContext: async () => ({ user: { id: 'owner' } }) },
    '@/lib/experience-context': { getExperienceContext: () => ({ scope: 'owner:salon:grant' }) },
    '@/lib/market-experience-data': { loadMarketExperienceData: async () => { reads++; return state; } },
    '@/lib/experience-live-resource-server': helpers,
  });
  return { GET, state, reads: () => reads };
}
const request = (query = 'scope=owner%3Asalon%3Agrant', headers) => new Request(`https://reylumi.test/api/experience/market?${query}`, { headers });

test('Market rejects an old workspace before loading any business data', async () => {
  const f = fixture();
  const response = await f.GET(request('scope=old-workspace'));
  assert.equal(response.status, 409);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(f.reads(), 0);
});
test('Market preserves old UI during authentication outages without turning it into a guest snapshot', async () => {
  const f = fixture({ unavailable: true });
  assert.equal((await f.GET(request())).status, 503);
  assert.equal(f.reads(), 0);
});
test('Market unchanged data sends no body; a changed installation sends only its section', async () => {
  const f = fixture();
  const initial = await f.GET(request());
  const snapshot = await initial.json();
  const unchanged = await f.GET(request(undefined, { 'If-None-Match': initial.headers.get('etag') }));
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), '');
  f.state.installed = true;
  const changed = await f.GET(request(`scope=owner%3Asalon%3Agrant&sections=${encodeURIComponent(JSON.stringify(snapshot.sections))}`));
  const next = await changed.json();
  assert.deepEqual(next.data, { installed: true });
  assert.equal(next.partial, true);
  assert.equal(changed.headers.get('vary'), 'Cookie');
});
test('Market request fence propagates prerender cancellation without performing business reads', async () => {
  const cancellation = new Error('prerender cancelled');
  const f = fixture({ fence: async () => { throw cancellation; } });
  await assert.rejects(f.GET(request()), error => error === cancellation);
  assert.equal(f.reads(), 0);
});
