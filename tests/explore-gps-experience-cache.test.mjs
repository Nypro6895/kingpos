import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function harness({ blocked = false, fails = false } = {}) {
  const entries = new Map(); let time = 10000, calls = 0;
  const area = { label: 'Milwaukee, WI', city: 'Milwaukee', state: 'WI', postalCode: null, country: 'US', source: 'gps', provider: 'us_census', precision: 'city', attribution: { label: 'Census', url: 'https://www.census.gov' } };
  const globals = { Date: { now: () => time }, AbortController, DOMException, setTimeout, clearTimeout,
    window: { sessionStorage: { get length() { return entries.size; }, key: index => [...entries.keys()][index], getItem(key) { if (blocked) throw Error('denied'); return entries.get(key); }, setItem(key, value) { if (blocked) throw Error('denied'); entries.set(key, value); }, removeItem: key => entries.delete(key) } },
  };
  function load(file, deps = {}) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports, ...globals, fetch: async () => { calls++; if (fails) throw Error('network'); return { ok: true, json: async () => ({ area, error: null }) }; }, require: name => deps[name] });
    return exports;
  }
  const storage = load('lib/experience-state.ts');
  const api = load('lib/location/explore-gps-area-client.ts', { '@/lib/experience-state': storage });
  return { read: api.fetchExploreGpsArea, calls: () => calls, advance: ms => { time += ms; }, entries };
}
const point = { latitude: 43.0389, longitude: -87.9065 };
const signal = () => new AbortController().signal;

test('revisiting the exact GPS point reuses its short-lived area but different users and boundaries require fresh resolution', async () => {
  const h = harness(); await h.read(point, signal(), 'alice'); await h.read(point, signal(), 'alice'); assert.equal(h.calls(), 1);
  await h.read({ ...point, latitude: point.latitude + .000001 }, signal(), 'alice'); assert.equal(h.calls(), 2);
  await h.read(point, signal(), 'bob'); assert.equal(h.calls(), 3);
  h.advance(600001); await h.read(point, signal(), 'alice'); assert.equal(h.calls(), 4);
});

test('denied storage, aborted requests and failed geocoding cannot create a misleading area snapshot', async () => {
  const denied = harness({ blocked: true }); await denied.read(point, signal(), 'alice'); assert.equal(denied.calls(), 1);
  const failed = harness({ fails: true }); await assert.rejects(failed.read(point, signal(), 'alice')); assert.equal(failed.entries.size, 0);
  const h = harness(); await h.read(point, signal(), 'alice'); const aborted = new AbortController(); aborted.abort();
  await assert.rejects(h.read(point, aborted.signal, 'alice'), error => error.name === 'AbortError'); assert.equal(h.calls(), 1);
});
