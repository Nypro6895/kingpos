import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

async function compile(entry, stubs) {
  const output = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node', alias: { '@': process.cwd() }, plugins: [{ name: 'pinned-http-fixture', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => { const key = Object.keys(stubs).find(key => args.path === key || args.path.endsWith('/' + key)); return key ? { path: key, namespace: 'fixture' } : undefined; });
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: stubs[args.path] }));
  } }] });
  return import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
}
const wire = (status, value) => ({ status, body: JSON.stringify(value), headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

test('role HTTP composes with the existing transport and bridges only exact native method/path pairs', async () => {
  const { createAppLocalRoleHttpFetch } = await compile('lib/app-local-role-http-client.ts', { 'app-local-host': 'export const getAppLocalHost=()=>({isNative:false});' });
  const calls = [], forwarded = [], host = { isNative: true, read: async (name, args, options) => { calls.push({ name, args, options }); return { scope: options.scope, data: wire(403, { message: 'No permission' }) }; }, command: async () => { throw Error('Unexpected mutation'); } };
  const read = createAppLocalRoleHttpFetch({ scope: () => 'scope-a', host: () => host, fetch: async (...args) => { forwarded.push(args); return new Response('existing-owner-adapter'); } });
  const result = await read('/api/staff/create-appointment?salonId=salon-a&catalog=1');
  assert.equal(result.status, 403); assert.deepEqual(await result.json(), { message: 'No permission' });
  assert.deepEqual(calls[0].args, { salonId: 'salon-a', catalog: '1' }); assert.equal(calls[0].name, 'http.staff.creation');
  for (const url of ['/api/pos/owner/workspace', '/api/staff/booking-preferences', 'https://other.example/api/staff/create-appointment']) assert.equal(await (await read(url)).text(), 'existing-owner-adapter');
  await assert.rejects(read('/api/staff/create-appointment?salonId=a&salonId=b'), /Unsupported/);
  await assert.rejects(read('/api/staff/create-appointment?token=credential'), /Unsupported/);
  assert.equal(calls.length, 1); assert.equal(forwarded.length, 3);
  host.isNative = false;
  assert.equal(await (await read('/api/notifications/preferences')).text(), 'existing-owner-adapter');
});

test('appointment cancellation and ambiguous network failures never replay a write, and scope changes reject late results', async () => {
  const { createAppLocalRoleHttpFetch } = await compile('lib/app-local-role-http-client.ts', { 'app-local-host': 'export const getAppLocalHost=()=>({isNative:false});' });
  let scope = 'scope-a', resolve, attempts = 0;
  const host = { isNative: true, command: async () => { attempts++; return new Promise(done => { resolve = done; }); } };
  const read = createAppLocalRoleHttpFetch({ scope: () => scope, host: () => host, fetch: async () => { throw Error('Unexpected passthrough'); } });
  const controller = new AbortController(), pending = read('/api/staff/create-appointment', { method: 'POST', body: JSON.stringify({ action: 'create', appointment: { key: 'one-idempotency-key' } }), signal: controller.signal });
  await new Promise(done => setImmediate(done)); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' }); resolve(wire(200, { ok: true }));
  await new Promise(done => setImmediate(done)); assert.equal(attempts, 1);
  const changed = read('/api/staff/confirm-booking', { method: 'POST', body: JSON.stringify({ bookingId: 'booking-a' }) });
  await new Promise(done => setImmediate(done)); scope = 'scope-b'; resolve(wire(200, { ok: true }));
  await assert.rejects(changed, /account has changed/); assert.equal(attempts, 2);
});

async function serverFixture() {
  const state = globalThis.roleHttpFixture = { scope: 'scope-a', user: { id: 'viewer-a' }, calls: [], cookie: 'test-session=fixture-only', status: 409 };
  const handler = name => `export async function ${name.endsWith('GET') ? 'GET' : 'POST'}(request){const s=globalThis.roleHttpFixture;s.calls.push({name:${JSON.stringify(name)},url:request?.url,origin:request?.headers.get('origin'),cookie:request?.headers.get('cookie'),body:request?.method==='POST'?await request.json():null});return Response.json({message:'Original handler result'},{status:s.status,headers:{'Cache-Control':'no-store'}})}`;
  const stubs = { 'server-only': '', 'next/headers': 'export const headers=async()=>new Headers({cookie:globalThis.roleHttpFixture.cookie});', 'request-business-context': 'export const getRequestBusinessContext=async()=>globalThis.roleHttpFixture;', 'experience-context': 'export const getExperienceContext=context=>({scope:context.scope});', 'staff-portal-identity':'export const getStaffPortalIdentity=async()=>globalThis.roleHttpFixture.staff??{context:{},staff:null};', '@/app/api/staff/create-appointment/route': handler('creationGET') + handler('creationPOST'), '@/app/api/staff/report-no-show/route': handler('noShowPOST'), '@/app/api/staff/confirm-booking/route': handler('confirmPOST'), '@/app/api/staff/booking-preferences/route': handler('staffPreferencesPOST'), '@/app/api/notifications/preferences/route': handler('notificationsGET') + handler('notificationsPOST') };
  return { state, api: await compile('lib/app-local-role-http-server.ts', stubs) };
}

test('server role adapters validate the fresh scope before original handlers and preserve their failure response', async () => {
  const { state, api } = await serverFixture();
  await assert.rejects(api.readAppLocalRoleHttpResource('http.staff.creation', { salonId: 'salon-a' }, { scope: 'other' }), { status: 409 });
  assert.deepEqual(state.calls, []);
  const result = await api.readAppLocalRoleHttpResource('http.staff.creation', { salonId: 'salon-a', catalog: '1' }, { scope: 'scope-a' });
  assert.equal(result.data.status, 409); assert.deepEqual(JSON.parse(result.data.body), { message: 'Original handler result' });
  assert.equal(state.calls[0].cookie, state.cookie); assert.equal(new URL(state.calls[0].url).searchParams.get('catalog'), '1');
  state.user = null;
  await assert.rejects(api.readAppLocalRoleHttpResource('http.notifications.preferences', {}, { scope: 'scope-a' }), { status: 401 });
  assert.equal(state.calls.length, 1);
});

test('custom local URLs cannot confuse another host with the null origin, and trusted same-viewer staff scopes retain their original endpoint access', async () => {
  const { createAppLocalRoleHttpFetch } = await compile('lib/app-local-role-http-client.ts', { 'app-local-host': 'export const getAppLocalHost=()=>({isNative:false});' });
  const previous = globalThis.location; globalThis.location = new URL('reylumi-app://installed/index.html');
  try {
    let calls = 0, pass = 0;
    const read = createAppLocalRoleHttpFetch({ scope: () => 'staff-scope', host: () => ({ isNative: true, read: async () => { calls++; return { scope: 'staff-scope', data: wire(200, {}) }; } }), fetch: async () => { pass++; return new Response('passthrough'); } });
    await read('reylumi-app://other/api/staff/create-appointment'); await read('//foreign.example/api/staff/create-appointment');
    assert.equal(calls, 0); assert.equal(pass, 2);
    assert.equal((await read('/api/staff/create-appointment?salonId=a')).status, 200); assert.equal(calls, 1);
  } finally { if (previous === undefined) delete globalThis.location; else globalThis.location = previous; }
  const { state, api } = await serverFixture(); state.staff = { context: { scope: 'staff-scope', user: { id: state.user.id } }, staff: { id: 'staff-a' } };
  const allowed = await api.readAppLocalRoleHttpResource('http.staff.creation', { salonId: 'salon-a' }, { scope: 'staff-scope' });
  assert.equal(allowed.scope, 'staff-scope'); assert.equal(state.calls.length, 1);
  state.staff.context.user.id = 'another-viewer';
  await assert.rejects(api.readAppLocalRoleHttpResource('http.staff.creation', { salonId: 'salon-a' }, { scope: 'staff-scope' }), { status: 409 });
  assert.equal(state.calls.length, 1);
});

test('server role writes reject foreign origins/extra paths and call only the pinned original action once', async () => {
  const { state, api } = await serverFixture();
  const req = new Request('https://reylumi.com/api/app-local/command', { method: 'POST', headers: { origin: 'https://reylumi.com', cookie: state.cookie } });
  assert.deepEqual(await api.runAppLocalRoleHttpCommand('not.a.proxy', {}, req, 'scope-a'), { handled: false });
  await assert.rejects(api.runAppLocalRoleHttpCommand('http.staff.create-appointment', { input: {}, path: '/other' }, req, 'scope-a'), { status: 400 });
  const foreign = new Request(req.url, { method: 'POST', headers: { origin: 'https://foreign.example' } });
  await assert.rejects(api.runAppLocalRoleHttpCommand('http.staff.create-appointment', { input: {} }, foreign, 'scope-a'), { status: 403 });
  assert.deepEqual(state.calls, []);
  const input = { action: 'create', salonId: 'salon-a', appointment: { key: 'original-idempotency-key' } };
  const result = await api.runAppLocalRoleHttpCommand('http.staff.create-appointment', { input }, req, 'scope-a');
  assert.equal(result.status, 409); assert.equal(result.handled, true);
  assert.equal(state.calls.length, 1); assert.deepEqual(state.calls[0].body, input); assert.equal(state.calls[0].origin, 'https://reylumi.com');
});
