import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
async function endpoint(role) {
  const fixture = `
const probe=()=>globalThis.roleProbe;
export const connection=async()=>{probe().events.push('connection')};
export const headers=async()=>new Headers(probe().unavailable?{'x-reylumi-auth-unavailable':'1'}:{});
export const getRequestBusinessContext=async()=>{probe().events.push('context');return probe().context};
export const getExperienceContext=context=>({scope:context.scope});
export const runReadWithDeadline=value=>value;
export const getStaffPortalIdentity=async()=>{probe().events.push('identity');return{context:probe().context,staff:probe().staff}};
export const getCurrentStaffAppointments=async()=>{probe().events.push('schedule');return{context:probe().scheduleContext??probe().context,staff:probe().staff,appointments:[{id:'appointment'}],timezone:'America/Chicago'}};
export const getTodaysStaffWorkday=async()=>({context:probe().context,staff:probe().staff,today:'2026-10-16',workday:{id:'workday',status:'working',check_in_at:'today',check_out_at:null,private:'not a view field'}});
export const getCurrentSalonStaffActivitySummaries=async()=>new Map([[probe().staff.id,{assignedServices:1}]]);
export const getCustomerActivity=async()=>{probe().events.push('activity');return probe().result};
export const getCustomerActivityReceipt=async()=>{probe().events.push('receipt');return probe().receiptResult??probe().result};
export const listCustomerBookings=async()=>{probe().events.push('bookings');return probe().result};
export const getCustomerBookingDetail=async()=>{probe().events.push('booking');return probe().bookingResult??probe().result};
export const getAccountFollowing=async()=>{probe().events.push('following');return{items:[]}};
export const getAccountSavedPosts=async()=>{probe().events.push('saved');return[]};`;
  const result = await build({ entryPoints: [path.resolve(`app/api/experience/${role}/route.ts`)], bundle: true, write: false, format: 'cjs', platform: 'node',
    plugins: [{ name: 'controlled-role-authority', setup(builder) {
      builder.onResolve({ filter: /^server-only$/ }, () => ({ path: 'empty', namespace: 'fixture' }));
      builder.onResolve({ filter: /^next\// }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onResolve({ filter: /^@\// }, args => /experience-live-resource-server|customer-experience-resource-server|staff-experience-resource-server|app\/activity\/history-details-actions/.test(args.path)
        ? { path: path.resolve(args.path.replace('@/', '') + '.ts') } : { path: args.path, namespace: 'fixture' });
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path === 'empty' ? '' : fixture }));
    } }],
  });
  const module = { exports: {} }; new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, require); return module.exports.GET;
}
function probe(overrides = {}) { return globalThis.roleProbe = { events: [], context: { scope: 'authorized', user: { id: 'viewer' }, currentSalon: { id: 'salon' } }, staff: { id: 'staff' }, result: { ok: true, data: { history: [] } }, ...overrides }; }
const request = query => new Request('https://fixture.test/api/experience/view?' + query);

test('customer read endpoint fences request/auth/scope before loading any private data', async () => {
  const get = await endpoint('customer');
  let state = probe({ unavailable: true }); assert.equal((await get(request('scope=authorized'))).status, 503); assert.deepEqual(state.events, ['connection']);
  state = probe({ context: { scope: 'authorized', user: null } }); assert.equal((await get(request('scope=authorized'))).status, 401); assert.deepEqual(state.events, ['connection', 'context']);
  state = probe(); assert.equal((await get(request('scope=former-account'))).status, 409); assert.deepEqual(state.events, ['connection', 'context']);
  delete globalThis.roleProbe;
});

test('customer views reuse authorized reads, sanitize booking notes, return ETag304, and reject invalid input without a mutation', async () => {
  const get = await endpoint('customer'); const id = '11111111-1111-4111-8111-111111111111';
  const state = probe({ result: { ok: true, data: { id, notes: 'private', internal_notes: 'staff secret', events: ['audit'], lines: [{ service_note: 'internal service note', name: 'Nails' }] } } });
  const response = await get(request(`scope=authorized&kind=history&bookingId=${id}`)); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const body = await response.json(); assert.equal(body.data.result.booking.internal_notes, null); assert.equal(body.data.result.booking.notes, null); assert.equal(body.data.result.booking.lines[0].service_note, null); assert.equal(body.data.result.booking.events, undefined);
  const again = new Request(request(`scope=authorized&kind=history&bookingId=${id}`), { headers: { 'if-none-match': response.headers.get('etag') } }); assert.equal((await get(again)).status, 304);
  const before = state.events.length; assert.equal((await get(request('scope=authorized&kind=following&filter=other'))).status, 400); assert.deepEqual(state.events.slice(before), ['connection', 'context']);
  assert.equal((await get(request('scope=authorized&kind=history&bookingId=not-a-uuid'))).status, 400);
  probe({ result: { ok: false, code: 'not_found', message: 'Missing' } }); assert.equal((await get(request(`scope=authorized&kind=history&ticketId=${id}`))).status, 404);
  probe({ bookingResult: { ok: true, data: { id, historyEvidence: { ticket: { ticketId: id } } } }, receiptResult: { ok: true, data: { ticketId: 'different-ticket' } } });
  assert.equal((await get(request(`scope=authorized&kind=history&bookingId=${id}&ticketId=${id}`))).status, 404, 'linked record guard from existing history action stays authoritative');
  delete globalThis.roleProbe;
});

test('staff reads preserve actual staff scope and never serialize account/session context or raw workday fields', async () => {
  const get = await endpoint('staff'); let state = probe();
  assert.equal((await get(request('scope=authorized&staffId=old-staff'))).status, 409); assert.deepEqual(state.events, ['connection', 'identity']);
  state = probe({ scheduleContext: { scope: 'other' } }); assert.equal((await get(request('scope=authorized&staffId=staff&kind=schedule'))).status, 409); assert.ok(state.events.includes('schedule'));
  probe(); const schedule = await get(request('scope=authorized&staffId=staff&kind=schedule')); assert.equal(schedule.status, 200); const data = (await schedule.json()).data; assert.equal(data.result.context, undefined); assert.equal(data.staffId, 'staff');
  probe(); const workday = await get(request('scope=authorized&staffId=staff&kind=workday')); assert.equal(workday.status, 200); const view = (await workday.json()).data.result; assert.equal(view.workday.private, undefined); assert.equal(view.activity.assignedServices, 1);
  delete globalThis.roleProbe;
});
