import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as crypto from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const scope = 'v3:' + 'a'.repeat(64);
const phases = ['full','shell','staff','bookings','waiting','financials','extras'];
const phaseDelays = { full:37,shell:1,staff:5,bookings:7,waiting:3,financials:19,extras:2 };
const fixedDate = 1792368000000;
class FixtureDate extends Date { constructor(...args) { super(...(args.length ? args : [fixedDate])); } static now() { return fixedDate; } }

function load(file, dependencies = {}, now = () => performance.now()) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require','exports','performance','Date','console',code)(name => {
    assert.ok(Object.hasOwn(dependencies,name), 'Unexpected dependency ' + name + ' in ' + file);
    return dependencies[name];
  },exports,{now},FixtureDate,{error() {}});
  return exports;
}

function fixture({ timed = true, realDelays = false } = {}) {
  const request = new AsyncLocalStorage();
  const now = () => realDelays ? performance.now() : request.getStore()?.clock ?? 0;
  const state = () => { assert.ok(request.getStore(), 'Every synthetic request has an isolated context'); return request.getStore(); };
  const step = async ms => { if (realDelays) await new Promise(resolve => setTimeout(resolve,ms)); else { state().clock += ms; await Promise.resolve(); } };
  const timing = load('lib/read-request-timing.ts',{},now);
  const timingDependency = timed ? timing : { createReadRequestTiming: () => ({ measure: (_stage,read) => read(), measureToday: (_phase,read) => read(), measureSync: (_stage,read) => read(), finish: value => value }) };
  const reads = load('lib/read-context-scope.ts',{'server-only':{},'node:async_hooks':{AsyncLocalStorage}},now);
  const contextKey = Symbol('synthetic-request-context');
  const getContext = () => reads.memoizeReadContext(contextKey,async () => { const s = state(); s.authReads++; await step(s.authDelay); if (s.authError) throw s.authError; return s.context; });
  const sections = load('lib/today-dashboard-sections.ts',{},now);
  const getDashboard = async (_context,options) => {
    const s = state(), phase = options.phase ?? 'full'; s.dashboardReads.push(phase);
    await step(s.phaseDelay ?? phaseDelays[phase]);
    if (s.loadError) throw s.loadError;
    return { date:options.date ?? '2026-10-19',generatedAt:'2026-10-19T00:00:00.000Z',noAccess:s.noAccess,loadErrors:s.incomplete ? [{area:'financials',message:'Synthetic unavailable source'}] : [],summary:{sales:{value:25}},phase };
  };
  const headers = async () => { await step(state().headerDelay); return new Headers(state().unavailable ? {'x-reylumi-auth-unavailable':'1'} : {}); };
  const commonRoute = {
    'next/server':{connection:async () => step(state().connectionDelay)},'next/headers':{headers},
    '@/lib/read-context-scope':reads,'@/lib/read-request-timing':timingDependency,
    '@/lib/experience-context':{getExperienceContext:value => ({scope:value.scope})},
    '@/lib/request-business-context':{getRequestBusinessContext:getContext},
  };
  const commonAdapter = {
    'server-only':{},'node:crypto':crypto,'./read-context-scope':reads,
    './request-business-context':{getRequestBusinessContext:getContext},
    './experience-context':{getExperienceContext:value => ({scope:value.scope})},
    './current-context':{isSalonManageContext:value => value.manage !== false,isOwnerMembership:() => true},
    './bounded-get':load('lib/bounded-get.ts',{},now),'./staff-portal-identity':{},'./customer-bookings':{},'./permissions':{},
  };
  const role = load('lib/app-local-role-resources-server.ts',{
    ...commonAdapter,'./app-local-role-resources':load('lib/app-local-role-resources.ts',{},now),'./today-dashboard-sections':sections,
    './today-dashboard':{getTodayDashboard:getDashboard},'./supabase/server':{},'./account-social':{},'./customer-experience-resource-server':{},
    './staff-experience-resource-server':{},'./staff-my-work-resource-server':{},'./explore-reference-favorites':{},
  },now);
  const platform = load('lib/app-local-platform-resources-server.ts',{
    ...commonAdapter,'./app-local-platform-types':load('lib/app-local-platform-types.ts',{},now),'./app-local-role-resources-server':role,
    './market-experience-data':{},'@/app/settings/settings-hub-actions':{},'./customer-activity':{},'./staff-workdays':{},'./market-plugins':{},'./booking-deposit-market':{},
    './owner-transfer':{},'@/app/my-place/actions':{},'./customer-identity-claims':{},'./services':{},'./support-cases':{},'@/app/role-navigation':{},'@/app/campaigns/credit-actions':{},
  },now);
  const nativeImports = Object.fromEntries([...readFileSync('app/api/app-local/read/route.ts','utf8').matchAll(/import \{ (\w+) \} from "(@\/lib\/app-local-[^"]+)";/g)].map(([,name,file]) => [file,{[name]:async () => null}]));
  const native = load('app/api/app-local/read/route.ts',{
    ...nativeImports,...commonRoute,'@/lib/app-local-scope-id':load('lib/app-local-scope-id.ts',{},now),
    '@/lib/app-local-role-resources-server':role,'@/lib/app-local-platform-resources-server':platform,
  },now);
  const hosted = load('app/api/experience/today/route.ts',{
    ...commonRoute,'@/lib/current-context':{getCurrentBusinessContext:getContext,isSalonManageContext:value => value.manage !== false},
    '@/lib/today-dashboard':{getTodayDashboard:getDashboard},'@/lib/today-dashboard-sections':sections,
    '@/lib/experience-live-resource-server':load('lib/experience-live-resource-server.ts',{'server-only':{},'node:crypto':crypto},now),
  },now);
  const context = load('app/api/app-local/context/route.ts',{
    ...commonRoute,'@/lib/experience-offline-policy':{getExperienceOfflinePath:value => value},
    '@/lib/staff-online-access-server':{getStaffOnlineOnlyAccess:async () => null},
    '@/lib/current-context':{getCurrentStaffBusinessContext:async () => { await step(state().staffDelay); return state().selectedContext ?? state().context; },isSalonManageContext:value => value.manage !== false},
    '@/lib/staff-portal-identity':{getStaffPortalIdentity:async () => { await step(state().staffDelay); return {context:state().selectedContext ?? state().context}; }},
    '@/lib/app-local-display-server':{readAppLocalDisplayContext:async () => { await step(state().displayDelay); return state().display; }},
    '@/lib/app-local-portable-context-server':{readAppLocalPortableContext:async () => { await step(state().portableDelay); return state().portable; }},
    '@/app/api/experience/offline-context/route':{GET:async () => {
      const s = state(); s.leaseReads++; await step(s.leaseDelay); if (s.leaseError) throw s.leaseError;
      return new Response(s.invalidLeaseJSON ? 'invalid json' : JSON.stringify(s.leaseStatus === 200 ? {kind:'owner',fixture:'private-grant-value'} : {error:'Synthetic unavailable',...(s.unconfirmed ? {offlineState:'unconfirmed'} : {})}),{status:s.leaseStatus,headers:{'content-type':'application/json'}});
    }},
  },now);
  const makeState = (options = {}) => ({
    clock:0,authReads:0,leaseReads:0,dashboardReads:[],connectionDelay:1,headerDelay:2,authDelay:3,displayDelay:1,portableDelay:1,staffDelay:4,leaseDelay:7,leaseStatus:200,
    context:{scope,user:{id:'synthetic-viewer',display_name:'Private fixture',language:'en'},currentMembership:{},currentBusiness:{},currentAccount:{},currentSalon:{id:'synthetic-salon'},manage:true,defaultRouteForCurrentContext:'/staff/today'},
    ...options,
  });
  const run = (handler,url,options = {},init) => { const s = makeState(options); return request.run(s,async () => ({response:await handler(new Request(url,init)),state:s})); };
  const query = phase => new URLSearchParams({scope,date:'2026-10-19',...(phase === 'full' ? {} : {phase})});
  return {
    timing,makeState,
    context:(options = {},query = 'path=/staff/today&generation=synthetic-generation-20261019') => run(context.GET,'https://fixture.invalid/api/app-local/context?'+query,options),
    hosted:(phase = 'full',options = {},init) => run(hosted.GET,'https://fixture.invalid/api/experience/today?'+query(phase),options,init),
    native:(phase = 'full',options = {},init) => run(native.GET,'https://fixture.invalid/api/app-local/read?'+new URLSearchParams({name:'page.owner-today',scope,args:JSON.stringify({date:'2026-10-19',...(phase === 'full' ? {} : {phase})})}),options,init),
    nativePost:(options,body,origin = 'https://fixture.invalid') => run(native.POST,'https://fixture.invalid/api/app-local/read',options,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}),
  };
}

function timings(response) {
  const header = response.headers.get('server-timing'); assert.ok(header);
  const result = {};
  for (const metric of header.split(', ')) {
    const match = /^([a-z_]+);dur=(\d+\.\d)$/.exec(metric); assert.ok(match,metric);
    assert.ok(['auth','validate','lease','load','serialize','total',...phases.map(phase => 'today_'+phase)].includes(match[1]));
    assert.equal(Object.hasOwn(result,match[1]),false,'a fixed stage is emitted only once');
    result[match[1]] = Number(match[2]);
  }
  assert.equal(/private|synthetic|v3:|grant-value|fixture\.invalid/i.test(header),false);
  return result;
}
async function sameResponse(timed,plain) {
  assert.equal(timed.status,plain.status);
  assert.equal(await timed.clone().text(),await plain.clone().text());
  assert.deepEqual([...timed.headers].filter(([name]) => name !== 'server-timing'),[...plain.headers]);
  timings(timed); assert.equal(plain.headers.has('server-timing'),false);
}

test('context separates the nested lease wait from auth and preserves successful/unavailable embedded grant bodies', async () => {
  const f = fixture(),plain = fixture({timed:false});
  for (const options of [{},{leaseStatus:503},{leaseStatus:503,unconfirmed:true},{invalidLeaseJSON:true}]) {
    const a = await f.context(options),b = await plain.context(options);
    await sameResponse(a.response,b.response);
    assert.deepEqual(timings(a.response),{auth:5,validate:2,lease:7,serialize:0,total:15});
    assert.equal(a.state.authReads,1); assert.equal(a.state.leaseReads,1);
    const data = await a.response.json(); assert.equal(data.grantStatus,options.leaseStatus ?? 200);
    if (options.leaseStatus === 503) { assert.equal(a.response.status,200); assert.equal(data.grant,null); }
  }
});

test('context early failures and device returns retain exact status/body while timing only work actually started', async () => {
  const f = fixture(),plain = fixture({timed:false});
  const cases = [
    [{unavailable:true},undefined,503,false],
    [{},'generation=short',400,false],
    [{authError:Object.assign(new Error('private-auth-detail'),{status:403})},undefined,403,false],
    [{leaseError:new Error('private-lease-detail')},undefined,503,true],
    [{selectedContext:{scope,user:{id:'changed-viewer'}}},'path=/staff/workday&generation=synthetic-generation-20261019',409,false],
    [{display:{schemaVersion:1,fixture:'display'}},undefined,200,false],
    [{portable:{schemaVersion:1,fixture:'portable'}},undefined,200,false],
  ];
  for (const [options,query,status,hasLease] of cases) {
    const a = await f.context(options,query),b = await plain.context(options,query); await sameResponse(a.response,b.response);
    assert.equal(a.response.status,status); assert.equal(Object.hasOwn(timings(a.response),'lease'),hasLease);
  }
});

test('every hosted Today phase has exactly its fixed span and preserves live ETag/full/304 contracts', async () => {
  const f = fixture(),plain = fixture({timed:false});
  for (const phase of phases) {
    const a = await f.hosted(phase),b = await plain.hosted(phase); await sameResponse(a.response,b.response);
    const t = timings(a.response); assert.equal(t.auth,5); assert.equal(t.load,phaseDelays[phase]); assert.equal(t['today_'+phase],phaseDelays[phase]);
    assert.deepEqual(Object.keys(t).filter(key => key.startsWith('today_')),['today_'+phase]);
    assert.deepEqual(a.state.dashboardReads,[phase]);
    const init = {headers:{'if-none-match':a.response.headers.get('etag')}};
    const conditional = await f.hosted(phase,{},init),control = await plain.hosted(phase,{},init); await sameResponse(conditional.response,control.response);
    assert.equal(conditional.response.status,304); assert.equal(await conditional.response.text(),'');
  }
});

test('hosted Today rejection and failed-load spans do not admit records or expose error messages', async () => {
  const f = fixture(),plain = fixture({timed:false});
  for (const options of [{unavailable:true},{context:{scope,user:null}},{context:{scope,user:{},manage:false}},{context:{scope:'old-scope',user:{},manage:true,currentBusiness:{},currentAccount:{},currentSalon:{}}}]) {
    const a = await f.hosted('financials',options),b = await plain.hosted('financials',options); await sameResponse(a.response,b.response);
    assert.ok([401,403,409,503].includes(a.response.status)); assert.deepEqual(a.state.dashboardReads,[]);
    assert.equal(Object.hasOwn(timings(a.response),'today_financials'),false);
  }
  for (const options of [{loadError:new Error('private-error-detail')},{incomplete:true},{noAccess:true}]) {
    const a = await f.hosted('financials',options),b = await plain.hosted('financials',options); await sameResponse(a.response,b.response);
    assert.equal(timings(a.response).today_financials,19); assert.equal(timings(a.response).load,19);
    assert.equal((await a.response.text()).includes('private-error-detail'),false);
  }
  const invalid = await f.hosted('private-injected-stage'); assert.equal(invalid.response.status,400); assert.deepEqual(invalid.state.dashboardReads,[]);
});

test('unexpected hosted auth exceptions keep their existing framework boundary instead of changing response policy', async () => {
  const failure = new Error('Synthetic unexpected auth failure');
  await assert.rejects(fixture().hosted('full',{authError:failure}),error => error === failure);
  await assert.rejects(fixture({timed:false}).hosted('full',{authError:failure}),error => error === failure);
});

test('native page/role timing shares the authorized read scope without changing envelopes or ETags', async () => {
  const f = fixture(),plain = fixture({timed:false});
  for (const phase of phases) {
    const a = await f.native(phase),b = await plain.native(phase); await sameResponse(a.response,b.response);
    const t = timings(a.response); assert.equal(t.auth,5); assert.equal(t.load,3+phaseDelays[phase]); assert.equal(t['today_'+phase],phaseDelays[phase]);
    assert.deepEqual(Object.keys(t).filter(key => key.startsWith('today_')),['today_'+phase]);
    assert.equal(a.state.authReads,1); assert.deepEqual(a.state.dashboardReads,[phase]);
    const conditional = await f.native(phase,{}, {headers:{'if-none-match':a.response.headers.get('etag')}}),control = await plain.native(phase,{}, {headers:{'if-none-match':a.response.headers.get('etag')}});
    await sameResponse(conditional.response,control.response); assert.equal(conditional.response.status,304);
    assert.equal(timings(conditional.response)['today_'+phase],phaseDelays[phase]);
  }
});

test('native denied/malformed/failed reads retain denial boundaries and report elapsed failed Today work', async () => {
  const f = fixture(),plain = fixture({timed:false});
  for (const options of [{unavailable:true},{context:{scope,user:null}},{context:{scope:'other',user:{}}},{loadError:new Error('private-error-detail')},{incomplete:true},{noAccess:true}]) {
    const a = await f.native('financials',options),b = await plain.native('financials',options); await sameResponse(a.response,b.response);
    assert.ok([401,403,409,503].includes(a.response.status));
    assert.equal(Object.hasOwn(timings(a.response),'today_financials'),Boolean(options.loadError || options.incomplete || options.noAccess));
  }
  const invalid = await f.native('private-injected-stage'); assert.equal(invalid.response.status,400); assert.deepEqual(invalid.state.dashboardReads,[]);
  const crossOrigin = await f.nativePost({}, {name:'page.owner-today',scope,args:{phase:'shell'}},'https://other.invalid');
  assert.equal(crossOrigin.response.status,403); assert.deepEqual(crossOrigin.state.dashboardReads,[]); assert.equal(Object.hasOwn(timings(crossOrigin.response),'load'),false);
});

test('concurrent native/hosted requests keep fixed phases and durations isolated to each response', async () => {
  const f = fixture();
  const results = await Promise.all(phases.flatMap(phase => [f.hosted(phase),f.native(phase)]));
  for (const [index,result] of results.entries()) {
    const phase = phases[Math.floor(index/2)],t = timings(result.response);
    assert.deepEqual(Object.keys(t).filter(key => key.startsWith('today_')),['today_'+phase]);
    assert.equal(t['today_'+phase],phaseDelays[phase]); assert.equal(result.state.authReads,1); assert.deepEqual(result.state.dashboardReads,[phase]);
  }
});

test('controlled real-delay handler samples separate context lease/auth and full/phase Today without live backends', async () => {
  const f = fixture({realDelays:true}),samples = [];
  for (const [kind,read] of [['context',() => f.context({authDelay:15,leaseDelay:25})],['hosted-full',() => f.hosted('full',{authDelay:15,phaseDelay:40})],['native-financials',() => f.native('financials',{authDelay:15,phaseDelay:30})]]) {
    const before = performance.now(),result = await read(),elapsedMs = performance.now()-before,t = timings(result.response);
    assert.equal(result.response.status,200); assert.ok(t.auth >= 14); assert.ok(t.total <= elapsedMs+1);
    if (kind === 'context') assert.ok(t.lease >= 24); else assert.ok(t.load >= (kind === 'hosted-full' ? 39 : 29));
    samples.push({kind,status:result.response.status,elapsedMs:Number(elapsedMs.toFixed(1)),serverTiming:t,authReads:result.state.authReads,leaseReads:result.state.leaseReads,modelReads:result.state.dashboardReads.length});
  }
  if (process.env.CONTEXT_TODAY_TIMING_EVIDENCE) {
    const target = path.resolve(process.env.CONTEXT_TODAY_TIMING_EVIDENCE); mkdirSync(path.dirname(target),{recursive:true});
    writeFileSync(target,JSON.stringify({at:new Date().toISOString(),mode:'Actual handlers with synthetic upstream delays; no live backend, owner requests, cookies or financial writes',samples,limitations:['These local controlled durations validate timing attribution, not production latency or device behavior','Today model itself is mocked; original calculations and permissions are covered by separate differential/authorization tests']},null,2));
  }
});
