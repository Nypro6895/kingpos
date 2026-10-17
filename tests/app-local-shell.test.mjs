import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
async function moduleFrom(file, fixtures) {
  const bundle = await build({ entryPoints: [file], bundle: true, write: false, platform: 'node', format: 'cjs', alias: { '@': process.cwd() }, plugins: [{ name: 'original-shell-authority', setup(b) { b.onResolve({ filter: /.*/ }, args => { const key = Object.keys(fixtures).find(key => args.path === key || args.path.endsWith('/' + key)); return key ? { path: key, namespace: 'fixture' } : undefined; }); b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: fixtures[args.path] })); } }] });
  const loaded = { exports: {} }; new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(loaded, loaded.exports, createRequire(import.meta.url)); return loaded.exports;
}
const summary = { items: [], beautyPublicationRequests: 0, bookingNotifications: 0, managerApplications: 0, previewItems: [], reviewHref: '/notifications', staffApplications: 0, staffInvites: 0, total: 0 };
async function fixture() {
  const s = globalThis.__shell = { scope: 'scope-a', calls: [], cookies: [], permissions: ['staff.view', 'booking.view'], role: 'manager', unavailable: false, pluginError: false, plugin: { active: true, staff_enabled: true, portable_enabled: false, trial_ends_at: '2026-12-01T00:00:00Z', paid_until: '2027-01-01T00:00:00Z' }, context: { user: { id: 'viewer', email: 'viewer@example.invalid', display_name: 'Owner', avatar_url: null, status: 'active', access_token: 'never-in-shell' }, currentAccount: { status: 'active' }, currentSalon: { id: 'salon-a', name: 'A', city: 'City', state: 'TX', country: 'US', status: 'active' }, currentStaffSalon: null, salonMode: 'manage', workspaceType: 'salon', currentMembership: {}, currentWorkspace: { id: 'manage:salon-a', type: 'salon', salonMode: 'manage' }, availableManageSalons: [{ id: 'salon-a', name: 'A' }, { id: 'salon-b', name: 'B' }], availableStaffSalons: [], workspaceOptions: [{ id: 'manage:salon-a', label: 'A' }], accountName: 'Account', unrelatedPrivate: { token: 'never-in-shell' } } };
  const api = await moduleFrom('lib/app-local-shell-server.ts', {
    'server-only': '', 'next/headers': `export const headers=async()=>new Headers({'cookie':'server-only=jar',...(globalThis.__shell.unavailable?{'x-reylumi-auth-unavailable':'1'}:{})});export const cookies=async()=>({set(value){globalThis.__shell.cookies.push(value)}})`,
    'next/server': 'export class NextRequest extends Request{}',
    'request-business-context': 'export const getRequestBusinessContext=async()=>globalThis.__shell.context',
    'experience-context': 'export const getExperienceContext=c=>({scope:c.testScope??globalThis.__shell.scope})',
    'current-context': `export const getCurrentStaffBusinessContext=async()=>{if(globalThis.__shell.workdayError)throw Error('temporary unavailable');return globalThis.__shell.workdayContext??globalThis.__shell.context};export const isSalonManageContext=c=>c.workspaceType==='salon'&&c.salonMode==='manage';export const isOwnerMembership=()=>globalThis.__shell.role==='owner';export const isSalonStaffContext=c=>c.salonMode==='staff';export const isAccountContext=c=>c.workspaceType==='account'`,
    'staff-portal-identity': 'export const getStaffPortalIdentity=async()=>{if(globalThis.__shell.portalError)throw Error("temporary unavailable");return{context:globalThis.__shell.portalContext??globalThis.__shell.context,staff:{id:"staff"}}}',
    'permissions': 'export const hasPermissionForRender=async(code)=>{globalThis.__shell.calls.push({kind:"permission",code});return globalThis.__shell.permissions.includes(code)}',
    'workspace-language-server': 'export const getWorkspaceTranslation=async()=>x=>x',
    '@/app/navigation-shell': 'export const NavigationShell=()=>null', '@/app/guest-navigation-shell': 'export const GuestNavigationShell=()=>null', '@/app/notifications/workspace-summary-seed': 'export const WorkspaceSummarySeed=()=>null',
    'workspace-pending': `export const emptyPendingSummary=()=>(${JSON.stringify(summary)});export const getWorkspacePendingSummary=async()=>(${JSON.stringify(summary)})`,
    'abuse-context': 'export const getSafetyContext=async()=>({deviceHash:"private-device-hash",ipHash:"private-ip-hash",country:"US"})',
    'abuse-server': 'export const abuseServiceClient=()=>({async rpc(name,args){globalThis.__shell.calls.push({kind:"abuse",name,args});return{data:{mode:"review"}}}})',
    'vietnamese-plugin': 'export async function vietnamesePluginState(salonId){globalThis.__shell.calls.push({kind:"language",salonId});if(globalThis.__shell.pluginError)throw Error("temporary");return globalThis.__shell.plugin}',
    'bounded-get': 'export const runReadWithDeadline=async p=>await p',
    'explore-advertising': `export function advertisingClient(){return{from(table){globalThis.__shell.calls.push({kind:'select',table});return{select(columns){globalThis.__shell.calls.at(-1).columns=columns;return this},eq(key,value){globalThis.__shell.calls.at(-1).filter={key,value};return this},async maybeSingle(){return{data:{installed:true,available_credits:123},error:null}}}}}}`,
    'owner-campaigns': 'export const ownerCampaignSettings=async()=>({enabled:true,promptsEnabled:true})',
    '@/app/(app)/api/auth/session/route': `export async function GET(){globalThis.__shell.calls.push({kind:'session'});return Response.json({authenticated:true,adminExpired:false})}`,
    '@/app/(app)/api/auth/logout/route': `export async function POST(){globalThis.__shell.calls.push({kind:'logout'});const r=Response.json({redirectTo:'/login'});r.cookies={getAll:()=>[{name:'auth',value:'',maxAge:0}]};return r}`,
    '@/app/(app)/workspace/open/route': `export async function GET(request){globalThis.__shell.calls.push({kind:'workspace',url:request.url,cookie:request.headers.get('cookie')});return new Response(null,{status:307,headers:{location:'https://reylumi.com/pos?workspace=selected'}})}`,
    '@/app/api/public-booking/context/route': `export async function GET(request){globalThis.__shell.calls.push({kind:'booking',url:request.url});return Response.json({state:'ready',salon:{name:'Current'}})}`,
    '@/app/api/explore/advertising/route': `export async function GET(){globalThis.__shell.calls.push({kind:'ads'});const r=Response.json({campaigns:[]});r.cookies={getAll:()=>[{name:'reylumi-ad-session',value:'server-only-ad-cookie',httpOnly:true}]};return r}export async function POST(request){globalThis.__shell.calls.push({kind:'ad-event',input:await request.json(),origin:request.headers.get('origin')});return Response.json({allowed:true})}`,
  }); return { api, s };
}
test('installed shell shares original permission-filtered navigation props without private context/credentials', async () => {
  const { api, s } = await fixture();
  const nav = await api.readAppLocalShellResource('shell.navigation', {}, { scope: s.scope });
  assert.equal(nav.data.navigation.currentUserId, 'viewer'); assert.equal(nav.data.ownerQueueScope, 'owner:salon-a:viewer'); assert.equal(nav.data.navigation.canSwitchManageSalon, true);
  assert.equal(s.calls.filter(x => x.kind === 'permission').length, 12); assert(!JSON.stringify(nav).includes('never-in-shell')); assert(!JSON.stringify(nav).includes('server-only=jar'));
  assert.equal(nav.data.navigation.workspaceSections[0].links.some(x => x.id === 'owner-profile'), false); assert(nav.data.navigation.workspaceSections[0].links.some(x => x.id === 'owner-book'));
  const unchanged = await api.readAppLocalShellResource('shell.navigation', {}, { scope: s.scope, etag: nav.etag }); assert.equal(unchanged.status, 304); assert.equal(unchanged.data, undefined);
  const pending = await api.readAppLocalShellResource('shell.summary', {}, { scope: s.scope }); assert.equal(pending.data.notificationScope, 'viewer:manage:salon-a'); assert.deepEqual(pending.data.summary, summary);
  const count = s.calls.length; await assert.rejects(() => api.readAppLocalShellResource('shell.navigation', {}, { scope: 'other' }), e => e.status === 409); assert.equal(s.calls.length, count);
  s.unavailable = true; await assert.rejects(() => api.readAppLocalShellResource('shell.navigation', {}, { scope: s.scope }), e => e.status === 503); assert.equal(s.calls.length, count);
  s.unavailable = false; s.context.user = null; s.context.salonMode = null; const guest = await api.readAppLocalShellResource('shell.navigation', {}, { scope: s.scope }); assert.equal(guest.data.navigation, null); assert.equal(guest.data.ownerQueueScope, null); assert.equal(guest.data.authenticated, false);
});
test('language uses original entitlement/expiry and optional campaign read never invokes billing/welcome actions', async () => {
  const { api, s } = await fixture(); s.role = 'owner';
  let value = await api.readAppLocalShellResource('shell.configuration', {}, { scope: s.scope }); assert.deepEqual(value.data.language, { enabled: true, portableEnabled: false, expiresAt: '2027-01-01T00:00:00Z' }); assert.equal(value.data.campaign.runtime.availableCredits, 123);
  assert.deepEqual(s.calls.find(x => x.kind === 'select'), { kind: 'select', table: 'campaign_wallets', columns: 'installed,available_credits', filter: { key: 'salon_id', value: 'salon-a' } });
  s.context.salonMode = 'staff'; s.context.currentStaffSalon = { id: 'staff-salon' }; s.plugin.staff_enabled = false; s.calls.length = 0;
  value = await api.readAppLocalShellResource('shell.configuration', {}, { scope: s.scope }); assert.equal(value.data.language.enabled, false); assert.equal(value.data.campaign.installed, false); assert.equal(s.calls[0].salonId, 'staff-salon'); assert(!s.calls.some(x => x.kind === 'select'));
  s.pluginError = true; await assert.rejects(() => api.readAppLocalShellResource('shell.configuration', {}, { scope: s.scope }));
  assert(!readFileSync('lib/app-local-shell-server.ts', 'utf8').includes('campaignWalletAction'));
});
test('safe warning DTO uses the original safety authority without exposing device, IP or rule details', async () => {
  const { api, s } = await fixture(); const result = await api.readAppLocalShellResource('shell.notice', {}, { scope: s.scope }); assert.deepEqual(result.data, { scope: 'scope-a', mode: 'review' });
  assert.deepEqual(s.calls.at(-1), { kind: 'abuse', name: 'get_abuse_notice', args: { p_user_id: 'viewer', p_device: 'private-device-hash', p_ip: 'private-ip-hash', p_country: 'US' } }); assert(!JSON.stringify(result).includes('private-device-hash')); assert(!JSON.stringify(result).includes('private-ip-hash'));
});
test('shell accepts original same-viewer staff fallback scopes without borrowing another viewer or classifying outage as revoke', async () => {
  const { api, s } = await fixture(); const staff = { ...s.context, testScope: 'staff-portal', salonMode: 'staff', currentStaffSalon: { id: 'staff-salon', name: 'Staff Salon' }, currentWorkspace: { id: 'staff:staff-salon', type: 'salon', salonMode: 'staff' } }; s.portalContext = staff; s.workdayContext = { ...staff, testScope: 'staff-workday' };
  const nav = await api.readAppLocalShellResource('shell.navigation', {}, { scope: 'staff-portal' }); assert.equal(nav.data.navigation.salonMode, 'staff'); assert.equal(nav.data.ownerQueueScope, null); assert.equal(nav.data.audience, 'staff');
  const language = await api.readAppLocalShellResource('shell.configuration', {}, { scope: 'staff-workday' }); assert.equal(language.data.scope, 'staff-workday'); assert.equal(s.calls.at(-1).salonId, 'staff-salon');
  s.portalContext = { ...staff, user: { ...staff.user, id: 'another-viewer' } }; await assert.rejects(() => api.readAppLocalShellResource('shell.navigation', {}, { scope: 'staff-portal' }), error => error.status === 409);
  s.portalError = true; s.workdayError = true; await assert.rejects(() => api.readAppLocalShellResource('shell.navigation', {}, { scope: 'staff-portal' }), error => error.status === 503);
});
test('named shell endpoints preserve original handlers, cookie jar updates and single command execution', async () => {
  const { api, s } = await fixture(), req = new Request('https://reylumi.com/api/app-local/command', { method: 'POST', headers: { origin: 'https://reylumi.com' } });
  const ads = await api.readAppLocalShellResource('http.shell.advertising', { path: '/explore', device: 'mobile' }, { scope: s.scope }); assert.equal(JSON.parse(ads.data.body).campaigns.length, 0); assert.equal(s.cookies[0].httpOnly, true); assert(!JSON.stringify(ads).includes('server-only-ad-cookie'));
  const result = await api.runAppLocalShellCommand('shell.switch-workspace', { workspaceId: 'manage:salon-b', destination: '/pos' }, req, s.scope); assert.equal(result.data.path, '/pos?workspace=selected'); assert.equal(s.calls.filter(x => x.kind === 'workspace').length, 1); assert.equal(s.calls.at(-1).cookie, 'server-only=jar');
  await assert.rejects(() => api.runAppLocalShellCommand('shell.switch-workspace', { workspaceId: 'a', url: 'https://foreign' }, req, s.scope), e => e.status === 400);
  const logout = await api.runAppLocalShellCommand('shell.logout', {}, req, s.scope); assert.equal(logout.data.status, 200); assert.equal(s.calls.filter(x => x.kind === 'logout').length, 1); assert.equal(s.cookies.at(-1).maxAge, 0);
  await api.runAppLocalShellCommand('http.shell.advertising-event', { input: { id: 'original-ad', event: 'view' } }, req, s.scope); assert.deepEqual(s.calls.at(-1).input, { id: 'original-ad', event: 'view' }); assert.equal(s.calls.at(-1).origin, 'https://reylumi.com');
  assert.deepEqual(await api.runAppLocalShellCommand('other', {}, req, s.scope), { handled: false });
});
test('native HTTP adapter leaves web/foreign requests intact, preserves business status, abort and logout reset', async () => {
  const { createAppLocalShellHttpFetch } = await moduleFrom('lib/app-local-shell-http-client.ts', { 'app-local-host': 'export const getAppLocalHost=()=>null', 'app-local-command-client': 'export const getAppLocalCommandScope=()=>null' });
  const calls = [], events = []; globalThis.window = new EventTarget(); window.addEventListener('reylumi:app-local-reset', () => events.push('reset'));
  let native = true; const host = { get isNative() { return native; }, async read(name, args) { calls.push({ name, args }); return { data: { status: 503, headers: { 'content-type': 'application/json' }, body: '{"error":"temporary"}' } }; }, async command(name, args) { calls.push({ name, args }); return { status: 200, headers: {}, body: '{"redirectTo":"/login"}' }; } };
  const wrapped = createAppLocalShellHttpFetch({ scope: () => 'scope-a', host: () => host, location: 'reylumi-app://bundle/index.html', fetch: async () => new Response('untouched') });
  assert.equal((await wrapped('/api/auth/session')).status, 503); assert.equal(calls[0].name, 'http.shell.session'); assert.equal(await (await wrapped('reylumi-app://foreign/api/auth/session')).text(), 'untouched'); assert.equal(await (await wrapped('//foreign/api/auth/session')).text(), 'untouched');
  native = false; assert.equal(await (await wrapped('/api/auth/session')).text(), 'untouched'); native = true;
  const controller = new AbortController(); controller.abort(); await assert.rejects(() => wrapped('/api/auth/session', { signal: controller.signal }));
  await wrapped('/api/auth/logout', { method: 'POST' }); assert.deepEqual(events, ['reset']); assert.equal(calls.filter(x => x.name === 'shell.logout').length, 1);
});
test('workspace handoff submits once and delegates destination admission to entry; obsolete account replies cannot navigate', async () => {
  let scope = 'scope-a', resolve, calls = [], events = [];
  globalThis.window = new EventTarget(); Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  globalThis.__shellScope = () => scope; globalThis.__shellHost = { isNative: true, async command(name, args, options) { calls.push({ kind: 'command', name, args, options }); return new Promise(r => resolve = r); }, async context(path, options) { calls.push({ kind: 'context', path, options }); return { schemaVersion: 1, context: { scope: 'scope-b', authenticated: true } }; } };
  window.addEventListener('reylumi:app-local-reset', () => { events.push('reset'); scope = undefined; }); window.addEventListener('reylumi:app-local-context', event => { events.push(event.detail.context.scope); scope = event.detail.context.scope; }); window.addEventListener('reylumi:app-local-navigate', event => events.push(event.detail.path));
  window.addEventListener('reylumi:app-local-workspace-handoff', event => events.push(event.detail.path));
  const api = await moduleFrom('lib/app-local-shell-workspace-navigation.ts', { 'app-local-host': 'export const appLocalPath=x=>x;export const getAppLocalHost=()=>globalThis.__shellHost', 'app-local-command-client': 'export const getAppLocalCommandScope=()=>globalThis.__shellScope()' });
  api.navigateToWorkspace('manage:salon-b', '/pos'); api.navigateToWorkspace('manage:salon-b', '/pos'); assert.equal(calls.length, 1); resolve({ path: '/pos' }); await new Promise(resolve => setImmediate(resolve)); assert.equal(calls.length, 1); assert.deepEqual(events, ['/pos']);
  scope = 'scope-a'; calls = []; events = []; api.navigateToWorkspace('manage:salon-b'); scope = 'new-account'; resolve({ path: '/pos' }); await new Promise(resolve => setImmediate(resolve)); assert.equal(calls.length, 1); assert.deepEqual(events, [], 'an obsolete old-account handoff cannot reset or navigate the new session');
});
