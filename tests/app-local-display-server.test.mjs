import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const salon = '11111111-1111-4111-8111-111111111111', key = '22222222-2222-4222-8222-222222222222', deviceScope = salon + ':' + key, ownerScope = 'v3:' + 'a'.repeat(64), token = 'a'.repeat(32);
async function compile(entry, stubs) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm', alias: { '@': process.cwd() }, plugins: [{ name: 'display-original-authority', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => { const name = Object.keys(stubs).find(name => args.path === name || args.path.endsWith('/' + name)); return name ? { path: name, namespace: 'fixture' } : undefined; });
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: stubs[args.path] }));
  } }] });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
async function fixture() {
  const state = globalThis.displayFixture = { scope: ownerScope, context: { scope: ownerScope, user: { id: 'viewer', display_name: 'Owner' }, currentSalon: { id: salon }, manage: true }, permission: true, session: { salon_id: salon }, calls: [], hold: null, draft: { id: 'draft-a', salon_id: salon, token }, denied: false };
  const stubs = {
    'server-only': '',
    'next/headers': 'export const headers=async()=>new Headers();',
    'next/server': 'export class NextResponse extends Response{static json(data,options={}){return new NextResponse(JSON.stringify(data),{...options,headers:{"content-type":"application/json",...options.headers}})}}',
    'request-business-context': 'export const getRequestBusinessContext=async()=>{const s=globalThis.displayFixture;s.calls.push("context");return s.context};',
    'experience-context': 'export const getExperienceContext=context=>({scope:context.scope,viewerId:context.user?.id??null,salonId:context.currentSalon?.id??null,workspaceId:"workspace",permissionRevision:"r1",authenticated:Boolean(context.user)});',
    'current-context': 'export const isSalonManageContext=context=>context.manage;',
    'permissions': 'export const hasPermission=async()=>globalThis.displayFixture.permission;',
    'pos-tickets': 'export const POS_TICKET_PERMISSIONS={manage:"tickets.manage"};',
    '@/app/pos/actions': 'export async function getOrCreatePosLiveDraft(){const s=globalThis.displayFixture;s.calls.push("initialize-original-draft");if(s.hold)await s.hold;return{ok:true,data:s.draft}}export async function getPosLiveDraft(token){const s=globalThis.displayFixture;s.calls.push(["original-draft",token]);return{ok:true,data:s.draft}}export async function getCustomerDisplayServiceCatalog(token){globalThis.displayFixture.calls.push(["catalog",token]);return[{id:"service",name:"Manicure"}]}',
    '@/app/pos/portable/actions': 'export const getCurrentPortablePosSession=async()=>{globalThis.displayFixture.calls.push("session");return globalThis.displayFixture.session};export async function getPortablePosDeskData(){const s=globalThis.displayFixture;s.calls.push("portable-desk");return{salonId:s.session?.salon_id,liveDraft:s.draft}}',
    'pos-settings': 'export async function getPublicPosDisplaySettingsByToken(token){globalThis.displayFixture.calls.push(["settings",token]);return{salonName:"Original salon"}}',
    'app-local-portable-context-server': 'export async function readAppLocalPortableContext(path,generation){const s=globalThis.displayFixture;s.calls.push(["portable-context",path]);return{schemaVersion:1,context:{scope:"' + deviceScope + '"},portable:{scope:"' + deviceScope + '"},grant:{kind:"portable"}}}export async function requireAppLocalPortableScope(scope,cap){const s=globalThis.displayFixture;s.calls.push(["device-guard",scope,cap]);if(s.denied||scope!=="' + deviceScope + '")throw Object.assign(Error("Device changed"),{status:409});return s.session}',
    '@/app/api/experience/offline-context/route': 'export async function GET(request){const s=globalThis.displayFixture,url=new URL(request.url),now=Date.now();s.calls.push(["grant",url.searchParams.get("path")]);return Response.json({version:1,scope:s.context.scope,scopes:[s.context.scope],viewerId:s.context.user?.id??null,workspaceId:"workspace",salonId:s.context.currentSalon?.id??null,grantRevision:"r1",generation:url.searchParams.get("generation"),issuedAt:now,expiresAt:now+3600000,path:"/market",kind:s.context.user?"owner":"public"})}',
    'supabase/server': 'export const createSupabaseServerClient=()=>({rpc:async(name,args)=>{globalThis.displayFixture.calls.push([name,args]);return{data:"entry-a"}}});',
    'bounded-get': 'export const runReadWithDeadline=promise=>promise;',
  };
  return { state, api: await compile('lib/app-local-display-server.ts', stubs) };
}

test('Display context preserves original owner-first, paired-device fallback and safe public resolution', async () => {
  const { state, api } = await fixture(), requestHeaders = new Headers(), generation = 'fixture-device-generation';
  assert.equal(await api.readAppLocalDisplayContext('/pos/customer-display?token=anything', generation, requestHeaders), null);
  const owner = await api.readAppLocalDisplayContext('/pos/customer-display', generation, requestHeaders);
  assert.equal(owner.displayAuthority.kind, 'owner'); assert.equal(owner.context.scope, ownerScope); assert.equal(state.calls.includes('session'), false); assert.equal(state.calls.includes('initialize-original-draft'), false);
  state.permission = false;
  const portable = await api.readAppLocalDisplayContext('/pos/customer-display', generation, requestHeaders);
  assert.equal(portable.displayAuthority.kind, 'portable'); assert.equal(portable.context.scope, deviceScope); assert.deepEqual(state.calls.at(-1), ['portable-context', '/pos/portable']);
  state.session = null; state.context.user = null;
  const publicContext = await api.readAppLocalDisplayContext('/pos/customer-display', generation, requestHeaders);
  assert.equal(publicContext.displayAuthority.kind, 'public'); assert.equal(publicContext.context.authenticated, false); assert.equal(JSON.stringify(publicContext).includes('"token"'), false);
});

test('Display owner initialization is scoped, uses original ephemeral draft only after guards, and 304 still revalidates', async () => {
  const { state, api } = await fixture();
  assert.equal(await api.readAppLocalDisplayResource('arbitrary.table', {}, { scope: ownerScope }), null);
  await assert.rejects(api.readAppLocalDisplayResource('owner.customer-display', { salonId: 'other' }, { scope: ownerScope }), { status: 400 });
  await assert.rejects(api.readAppLocalDisplayResource('owner.customer-display', {}, { scope: 'other' }), { status: 409 });
  state.permission = false; await assert.rejects(api.readAppLocalDisplayResource('owner.customer-display', {}, { scope: ownerScope }), { status: 403 });
  assert.equal(state.calls.includes('initialize-original-draft'), false); state.permission = true;
  const result = await api.readAppLocalDisplayResource('owner.customer-display', {}, { scope: ownerScope });
  assert.equal(result.data.token, token); assert.equal(result.data.settings.salonName, 'Original salon');
  const second = await api.readAppLocalDisplayResource('owner.customer-display', {}, { scope: ownerScope, etag: result.etag });
  assert.equal(second.status, 304); assert.equal('data' in second, false); assert.equal(state.calls.filter(call => call === 'initialize-original-draft').length, 2);
  state.draft.salon_id = 'another-salon'; await assert.rejects(api.readAppLocalDisplayResource('owner.customer-display', {}, { scope: ownerScope }), { status: 409 });
});

test('paired Display settings omit the capability token and enforce current device, salon and original POS capability', async () => {
  const { state, api } = await fixture();
  const result = await api.readAppLocalDisplayResource('portable.customer-display-settings', {}, { scope: deviceScope });
  assert.equal(result.data.draftId, 'draft-a'); assert.equal(JSON.stringify(result.data).includes(token), false); assert.deepEqual(state.calls[0], ['device-guard', deviceScope, 'portable.pos.use']);
  state.denied = true; const count = state.calls.filter(value => value === 'portable-desk').length;
  await assert.rejects(api.readAppLocalDisplayResource('portable.customer-display-settings', {}, { scope: deviceScope }), { status: 409 }); assert.equal(state.calls.filter(value => value === 'portable-desk').length, count);
  state.denied = false; state.draft.salon_id = 'other'; await assert.rejects(api.readAppLocalDisplayResource('portable.customer-display-settings', {}, { scope: deviceScope }), { status: 409 });
});

test('only pinned original Display actions may use matching owner or paired token authority', async () => {
  const { state, api } = await fixture(), action = name => 'action.' + createHash('sha256').update('app/pos/actions.ts#' + name).digest('hex').slice(0, 24);
  assert.equal(await api.authorizeAppLocalDisplayCommand(action('submitPosDeskReceipt'), [{ token }], deviceScope), false);
  assert.equal(await api.authorizeAppLocalDisplayCommand(action('submitCustomerDisplayPhone'), [{ token, phone: '1234' }], deviceScope), true);
  await assert.rejects(api.authorizeAppLocalDisplayCommand(action('getPosLiveDraft'), ['b'.repeat(32)], deviceScope), { status: 409 });
  state.draft.salon_id = 'other'; await assert.rejects(api.authorizeAppLocalDisplayCommand(action('getPosLiveDraft'), [token], ownerScope), { status: 403 });
  state.draft.salon_id = salon; assert.equal(await api.authorizeAppLocalDisplayCommand(action('getPosLiveDraft'), [token], ownerScope), true);
  state.context.user = null; await assert.rejects(api.authorizeAppLocalDisplayCommand(action('getPosLiveDraft'), [token], ownerScope), { status: 401 });
});

test('Display HTTP reads retain original route bodies/status and cannot query another display token', async () => {
  const { state, api } = await fixture();
  const settings = await api.readAppLocalDisplayResource('display.http.settings', { token }, { scope: deviceScope }); assert.equal(settings.data.status, 200); assert.equal(JSON.parse(settings.data.body).salonName, 'Original salon');
  const entry = await api.readAppLocalDisplayResource('display.http.entry', { token }, { scope: deviceScope }); assert.deepEqual(JSON.parse(entry.data.body), { entry: 'entry-a' }); assert.equal(entry.data.headers['cache-control'], 'private, no-store');
  const oldCalls = state.calls.length; await assert.rejects(api.readAppLocalDisplayResource('display.http.entry', { token: 'b'.repeat(32) }, { scope: deviceScope }), { status: 409 }); assert.equal(state.calls.slice(oldCalls).some(call => Array.isArray(call) && call[0] === 'service_relay_entry'), false);
});

test('cancelled Display initialization never produces an envelope for a late response', async () => {
  const { state, api } = await fixture(); let done; state.hold = new Promise(resolve => done = resolve); const controller = new AbortController(), pending = api.readAppLocalDisplayResource('owner.customer-display', {}, { scope: ownerScope, signal: controller.signal });
  while (!state.calls.includes('initialize-original-draft')) await new Promise(resolve => setImmediate(resolve));
  controller.abort(); done(); await assert.rejects(pending, { name: 'AbortError' });
});

test('Display HTTP custom-scheme matching is exact, preserves other fetches/status and rejects late scope/cancel', async () => {
  const { createAppLocalDisplayHttpFetch } = await compile('lib/app-local-display-http-client.ts', { 'app-local-host': 'export const getAppLocalHost=()=>({isNative:false});' });
  const originalLocation = globalThis.location; globalThis.location = new URL('reylumi-app://bundle/pos/customer-display');
  try {
    let scope = deviceScope, finish; const reads = [], forwarded = [], host = { isNative: true, read: async (name, args, options) => { reads.push({ name, args, options }); return { scope: options.scope, data: { status: 503, body: '{"error":"Original unavailable"}', headers: { 'content-type': 'application/json' } } }; } };
    const fetch = createAppLocalDisplayHttpFetch({ scope: () => scope, host: () => host, fetch: async (...args) => { forwarded.push(args); return new Response('previous'); } });
    assert.deepEqual(await (await fetch('/api/service-relay/entry?token=')).json(), { entry: null }); assert.equal(reads.length, 0);
    const response = await fetch('/api/pos/customer-display/settings?token=' + token); assert.equal(response.status, 503); assert.equal(reads[0].name, 'display.http.settings');
    await fetch('reylumi-app://foreign/api/service-relay/entry?token=' + token); await fetch('//foreign/api/service-relay/entry?token=' + token); await fetch('/api/service-relay/entry', { method: 'POST' }); await fetch('/api/pos/owner/workspace'); assert.equal(forwarded.length, 4);
    await assert.rejects(fetch('/api/service-relay/entry?token=a&token=b'), /Invalid/); await assert.rejects(fetch('/api/service-relay/entry?salon=other'), /Invalid/);
    host.read = async (name, args, options) => new Promise(resolve => { finish = () => resolve({ scope: options.scope, data: { status: 200, body: '{}', headers: {} } }); });
    const late = fetch('/api/service-relay/entry?token=' + token); scope = 'other'; finish(); await assert.rejects(late, /display changed/);
    scope = deviceScope; const abort = new AbortController(), cancelled = fetch('/api/service-relay/entry?token=' + token, { signal: abort.signal }); abort.abort(); finish(); await assert.rejects(cancelled, { name: 'AbortError' });
  } finally { if (originalLocation === undefined) delete globalThis.location; else globalThis.location = originalLocation; }
});

test('public QR origin preserves web/localhost origins and canonicalizes only the installed bundle authority', async () => {
  const { browserPublicOrigin } = await compile('lib/browser-public-origin.ts', {}), old = globalThis.location;
  try { globalThis.location = new URL('http://localhost:3317/pos/customer-display'); assert.equal(browserPublicOrigin(), 'http://localhost:3317'); globalThis.location = new URL('https://reylumi.com/pos/customer-display'); assert.equal(browserPublicOrigin(), 'https://reylumi.com'); globalThis.location = new URL('reylumi-app://bundle/pos/customer-display'); assert.equal(browserPublicOrigin(), 'https://reylumi.com'); }
  finally { if (old === undefined) delete globalThis.location; else globalThis.location = old; }
});
