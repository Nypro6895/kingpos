import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const salonA = '11111111-1111-4111-8111-111111111111', salonB = '22222222-2222-4222-8222-222222222222';
async function fixture() {
  const state = globalThis.__salonSocialBridge = { scope: 'scope-a', actor: '33333333-3333-4333-8333-333333333333', client: true, actorError: false, queryError: false, queries: [], reads: [], originalFetch: [], gate: null };
  const fixtures = {
    'server-only': '', 'next/headers': `export const headers=async()=>new Headers({cookie:'fixture=current'})`,
    'request-business-context': 'export const getRequestBusinessContext=async()=>({user:{id:globalThis.__salonSocialBridge.actor}})',
    'experience-context': 'export const getExperienceContext=()=>({scope:globalThis.__salonSocialBridge.scope})',
    'app-local-host': 'export const getAppLocalHost=()=>null', 'app-local-command-client': 'export const getAppLocalCommandScope=()=>undefined',
    'explore-page-resource-server': 'export const buildQuickActions=async()=>[];export const getExploreUtilityContent=async()=>({});export const buildExploreDiscoveryContent=()=>({})',
    'explore-search': 'export const EXPLORE_PAGE_SIZE=12;export const getExploreWorkspaceLocation=async()=>({});export const searchExploreSalons=async()=>({})',
    'explore-feed': 'export const emptyFeedPage=()=>({})', 'explore-home': 'export const emptyHomeContent=()=>({});export const getExploreHomeContent=async()=>({})',
    'explore-query-routing': 'export const resolveExploreQueryRouting=async()=>({})', 'explore-showcase-content': 'export const enrichExploreShowcaseContent=x=>x',
    'explore-startup-feed-server': 'export const prepareExploreStartupFeed=async()=>({})', 'explore-comment-identity': 'export const exploreCommentIdentity=()=>({})',
    'bounded-get': 'export const runReadWithDeadline=async x=>await x',
    '@/lib/supabase/server': `export const createAuthenticatedSupabaseServerClient=async()=>{const s=globalThis.__salonSocialBridge;if(!s.client)return null;return{rpc:async name=>{if(name!=='current_public_user_id')throw Error('Unmapped RPC');return{data:s.actor,error:s.actorError?{}:null}},from(table){const q={table,filters:[],select(columns){q.columns=columns;return q},eq(key,value){q.filters.push([key,value]);return q},in(key,value){q.filters.push([key,value]);return q},then(resolve,reject){s.queries.push({table,columns:q.columns,filters:q.filters});return Promise.resolve(s.gate).then(()=>({error:s.queryError?{}:null,data:table==='explore_salon_preferences'?[{salon_id:'${salonA}',loved:true,saved:true,hidden:false}]:[{salon_id:'${salonB}'}]})).then(resolve,reject)}};return q}}}`,
    ...Object.fromEntries(['search', 'feed', 'area', 'suggestions'].map(name => ['@/app/api/explore/' + name + '/route', 'export const GET=()=>{throw Error("Unexpected other handler")};export const POST=GET;'])),
  };
  const output = await build({ stdin: { resolveDir: process.cwd(), contents: "export {createAppLocalExploreHttpFetch} from './lib/app-local-explore-http-client';export {readAppLocalExploreResource} from './lib/app-local-explore-server';export {APP_LOCAL_EXPLORE_READS} from './lib/app-local-explore-metadata';" }, bundle: true, write: false, platform: 'node', format: 'cjs', alias: { '@': process.cwd() }, plugins: [{ name: 'real-original-salon-social-route', setup(b) {
    b.onResolve({ filter: /.*/ }, a => { if (a.path === 'next/server') return { path: a.path, external: true }; const key = Object.keys(fixtures).find(key => a.path === key || a.path.endsWith('/' + key)); return key ? { path: key, namespace: 'fixture' } : undefined; });
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: fixtures[a.path] }));
  } }] });
  const module = { exports: {} }; new Function('module', 'exports', 'require', output.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
  let currentScope = state.scope; const host = { isNative: true, async read(name, args, options) { state.reads.push({ name, args, scope: options.scope }); return module.exports.readAppLocalExploreResource(name, args, options); }, async command() { throw Error('No command is allowed'); } };
  const fetch = module.exports.createAppLocalExploreHttpFetch({ scope: () => currentScope, host: () => host, fetch: async input => { state.originalFetch.push(String(input)); throw Error('Unmapped native fetch'); } });
  return { state, fetch, api: module.exports, scope(value) { currentScope = value; } };
}

test('actual native GET bridge reaches the original scoped salon-social handler with original actor, ID dedup and private response', async () => {
  const previous = globalThis.location; globalThis.location = { href: 'reylumi-app://bundle/explore' };
  try {
    const { fetch, state, api } = await fixture(); const response = await fetch(`/api/explore/salon-social?ids=${salonA},${salonB},${salonA}`);
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await response.json(), { states: { [salonA]: { loved: true, saved: true, hidden: false, following: false }, [salonB]: { loved: false, saved: false, hidden: false, following: true } } });
    assert.equal(state.originalFetch.length, 0); assert.equal(state.reads.length, 1); assert.equal(state.reads[0].name, 'http.explore.salon-social');
    assert.equal(state.queries.length, 2); for (const row of state.queries) { assert.deepEqual(row.filters.find(x => x[0] === 'user_id'), ['user_id', state.actor]); assert.deepEqual(row.filters.find(x => x[0] === 'salon_id'), ['salon_id', [salonA, salonB]]); }
    assert.deepEqual(api.APP_LOCAL_EXPLORE_READS.find(x => x.name === 'http.explore.salon-social'), { name: 'http.explore.salon-social', path: '/api/explore/salon-social', method: 'GET', argumentKeys: ['ids'], retain: false });
  } finally { globalThis.location = previous; }
});

test('actual original guest, expired-actor, unavailable and invalid-ID responses are preserved without retries', async () => {
  const { fetch, state } = await fixture(); state.client = false; assert.deepEqual(await (await fetch(`/api/explore/salon-social?ids=${salonA}`)).json(), { states: {} });
  state.client = true; state.actorError = true; assert.equal((await fetch(`/api/explore/salon-social?ids=${salonA}`)).status, 401);
  state.actorError = false; state.queryError = true; assert.equal((await fetch(`/api/explore/salon-social?ids=${salonA}`)).status, 503);
  assert.equal((await fetch('/api/explore/salon-social?ids=invalid')).status, 400);
  const ids = Array.from({ length: 61 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`);
  assert.equal((await fetch('/api/explore/salon-social?ids=' + ids.join(','))).status, 400); assert.equal(state.reads.length, 5); assert.equal(state.originalFetch.length, 0);
});

test('the pinned bridge rejects scope changes/cancellation/undeclared filters and never captures foreign URLs or other methods', async () => {
  const previous = globalThis.location; globalThis.location = { href: 'reylumi-app://bundle/explore' };
  try {
    const f = await fixture(), controller = new AbortController(); controller.abort(); await assert.rejects(f.fetch(`/api/explore/salon-social?ids=${salonA}`, { signal: controller.signal })); assert.equal(f.state.reads.length, 0);
    await assert.rejects(f.fetch(`/api/explore/salon-social?ids=${salonA}&token=private`), /Unsupported/); assert.equal(f.state.reads.length, 0);
    await assert.rejects(f.api.readAppLocalExploreResource('http.explore.salon-social', { ids: salonA }, { scope: 'other' }), e => e.status === 409);
    await assert.rejects(f.api.readAppLocalExploreResource('http.explore.salon-social', { ids: salonA, path: '/arbitrary' }, { scope: f.state.scope }), e => e.status === 400);
    for (const url of ['//foreign/api/explore/salon-social', 'reylumi-app://foreign/api/explore/salon-social', 'other-app://bundle/api/explore/salon-social']) await assert.rejects(f.fetch(url), /Unmapped native fetch/);
    await assert.rejects(f.fetch('/api/explore/salon-social', { method: 'POST', body: '{}' }), /Unmapped native fetch/); assert.equal(f.state.originalFetch.length, 4);
    let release; f.state.gate = new Promise(resolve => { release = resolve; }); const pending = f.fetch(`/api/explore/salon-social?ids=${salonA},${salonB}`);
    await new Promise(resolve => setImmediate(resolve)); f.scope('other'); release(); await assert.rejects(pending, /account has changed/);
  } finally { globalThis.location = previous; }
});
