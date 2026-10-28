import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {build} from 'esbuild';

async function loadModule(file) {
  const result = await build({entryPoints:[file],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'server-marker',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'marker',namespace:'marker'}));b.onLoad({filter:/.*/,namespace:'marker'},()=>({contents:'',loader:'js'}));}}]});
  return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
function functions(file,names,dependencies) {
  const ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  const selected=ast.statements.filter(s=>ts.isFunctionDeclaration(s)&&names.includes(s.name?.text));
  assert.equal(selected.length,names.length);
  const code=ts.transpileModule(selected.map(s=>s.getText(ast)).join('\n'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};new Function('exports',...Object.keys(dependencies),code)(exports,...Object.values(dependencies));return exports;
}

test('retained navigation keeps the latest family URL when closing a detail before leaving the page',async()=>{
  const {appLocalPageKey,rememberAppLocalPaths}=await loadModule('lib/app-local-page-key.ts');
  const key=path=>appLocalPageKey(path,path.startsWith('/settings')?'settings.hub':path.startsWith('/bookings')?'business.regular:bookings':undefined);
  let paths=['/settings','/settings?section=services','/bookings?date=2026-10-28','/bookings?date=2026-10-28&bookingId=qa'];
  paths=rememberAppLocalPaths(paths,['/bookings?date=2026-10-28','/pos-tickets/qa'],key);
  assert.deepEqual(paths,['/settings?section=services','/bookings?date=2026-10-28','/pos-tickets/qa']);
  assert.ok(!paths.some(path=>path.includes('bookingId=')),'inactive page must not revive a closed drawer');
  paths=rememberAppLocalPaths(paths,['/settings?section=services','/settings'],key);
  assert.equal(paths.at(-1),'/settings','Back must remain the newest settings view after leaving');
  assert.equal(rememberAppLocalPaths([],Array.from({length:25},(_,i)=>'/page/'+i),key).length,16);
});

test('failed Today financial transport settles loading, retains known money, and accepts a successful retry',async()=>{
  const {failTodayDashboardSection,mergeTodayDashboardSection}=await loadModule('lib/today-dashboard-sections.ts');
  const metric={value:'--',detail:'Loading…'};
  const base={date:'2026-10-27',timezone:'America/Chicago',dayView:{currentDate:'2026-10-27',isCurrentDate:true},permissions:{canViewBookings:true,canViewReports:true},
    generatedAt:'2026-10-28T00:00:00Z',noAccess:false,summary:{sales:{...metric},staff:{...metric},customers:{...metric},waiting:{...metric}},rightNow:{},performance:{},team:[],attention:[],loadErrors:[],pendingSections:{sections:['staff','financials'],metrics:['sales','staff'],details:true}};
  const failed=failTodayDashboardSection(base,'financials');
  assert.equal(failed.summary.sales.value,'--');assert.equal(failed.summary.sales.detail,'Data temporarily unavailable');
  assert.deepEqual(failed.pendingSections.sections,['staff']);assert.equal(failed.loadErrors[0].section,'financials');
  assert.equal(base.summary.sales.detail,'Loading…','original shell must remain immutable');
  const good={...base,summary:{...base.summary,sales:{value:'$1,755',detail:'30 closed tickets'}},loadErrors:[]};
  const recovered=mergeTodayDashboardSection(failed,good,'financials');
  assert.equal(recovered.summary.sales.value,'$1,755');assert.equal(recovered.loadErrors.length,0);
  const staleFailure=failTodayDashboardSection(recovered,'financials');assert.equal(staleFailure.summary.sales.value,'$1,755','a failed refresh never replaces verified money with zero');
  const wrongScope={...good,permissions:{...good.permissions,canViewReports:false}};
  assert.equal(mergeTodayDashboardSection(failed,wrongScope,'financials'),failed,'changed authority cannot merge retained financial data');
});

test('session validation reuse ends at the read request and fresh revocation checks cannot reuse it',async()=>{
  const {runWithReadContext,memoizeReadValidation,runWithFreshReadValidation}=await loadModule('lib/read-context-scope.ts');
  const key=Symbol('session');let calls=0,allowed=true;
  const read=()=>{calls++;return Promise.resolve(allowed);};
  const check=(authority='account:a/session:a/strict')=>memoizeReadValidation(key,authority,read);
  await runWithReadContext(async()=>{
    assert.deepEqual(await Promise.all([check(),check()]),[true,true]);
    assert.equal(await check(),true);assert.equal(calls,1,'nested readers share one complete verification');
    await check('account:b/session:a/strict');await check('account:a/session:b/strict');await check('account:a/session:a/optional');assert.equal(calls,4,'authority, session and failure policy remain isolated');
    allowed=false;assert.equal(await runWithFreshReadValidation(()=>check()),false,'final boundary sees revocation during the read');assert.equal(calls,5);
  });
  assert.equal(await runWithReadContext(()=>check()),false);assert.equal(calls,6,'next request verifies again');
  await check();await check();assert.equal(calls,8,'commands outside read scope always verify');
  let attempts=0;
  await runWithReadContext(async()=>{
    const retry=()=>memoizeReadValidation(key,'unavailable',async()=>{if(++attempts===1)throw Error('unavailable');return true;});
    await assert.rejects(retry(),/unavailable/);assert.equal(await retry(),true);
  });
});

test('closing history denies anonymous, other-salon and non-manager reads before touching the database',async()=>{
  const salonId='11111111-1111-4111-8111-111111111111';let context={user:null};let permission=true,queries=0;
  const {GET}=functions('app/api/pos/closing/history/route.ts',['GET'],{
    runWithReadContext:f=>f(),getRequestBusinessContext:async()=>context,isSalonManageContext:c=>c.salonMode==='manage',hasPermission:async()=>permission,
    createAuthenticatedSupabaseServerClient:async()=>{queries++;throw Error('unauthorized query');},
  });
  const request=()=>new Request(`https://reylumi.com/api/pos/closing/history?salonId=${salonId}&date=2026-10-27`);
  assert.equal((await GET(request())).status,401);
  context={user:{id:'user'},salonMode:'manage',currentSalon:{id:'other'}};assert.equal((await GET(request())).status,403);
  context.currentSalon.id=salonId;context.salonMode='staff';assert.equal((await GET(request())).status,403);
  context.salonMode='manage';permission=false;assert.equal((await GET(request())).status,403);
  assert.equal(queries,0);
});

test('daily report joins independent reads without changing effective totals or removing correction authority',async()=>{
  let rejectAuthority=false;let starts=[],release;const gate=new Promise(resolve=>release=resolve);
  const context={user:{id:'owner'}};const auth={context};const core={metadata:{ticketCount:30},staffRows:[{staffId:'ny'}],totals:{expectedTotal:1755}};
  const effective={totals:{expectedTotal:1755,actualTotal:1700},adjustmentTotals:{cashDelta:5},closingInputs:{cashAmount:1700},pendingCorrectionCount:1,snapshotTotals:null};
  let decorated=0;const businessDate='2026-10-27';
  const {getDailyPosReport}=functions('lib/daily-pos-report.ts',['getDailyPosReport'],{
    DAILY_POS_REPORT_PERMISSIONS:{view:'reports.view'},requireReportContext:async()=>{if(rejectAuthority)throw Error('Denied');return auth;},isDateInputValue:()=>true,
    loadLiveDailyPosReport:async()=>{starts.push('tickets');await gate;return core;},
    loadDailyClosingCorrectionRows:async()=>{starts.push('corrections');await gate;return {requests:[{id:'pending'}],adjustments:[{cashDelta:5}]};},
    getCurrentBusinessDate:async()=>{starts.push('clock');await gate;return businessDate;},
    ensureDailyClosingSnapshotFromCore:async(a,c,date)=>{assert.equal(date,businessDate);return {id:'closing'};},getSnapshotTotalsFromClosing:()=>null,snapshotDiffersFromLive:()=>false,
    getLockInfo:async(date,c,closing,diff,knownDate)=>{assert.equal(knownDate,businessDate);return {isLocked:false};},
    buildEffectiveTotalsResult:input=>{assert.equal(input.adjustmentRows[0].cashDelta,5);assert.equal(input.requestRows[0].id,'pending');return effective;},
    decorateDailyClosingCorrections:async()=>{decorated++;return {requests:['decorated'],adjustments:['decorated']};},loadStaffSnapshotRows:async()=>[],
  });
  const pending=getDailyPosReport(businessDate,context,undefined,{includeCorrectionDetails:false});
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(starts,['tickets','corrections','clock']);release();
  const today=await pending;assert.deepEqual(today.totals,effective.totals);assert.equal(today.pendingCorrectionCount,1);assert.equal(decorated,0);
  const report=await getDailyPosReport(businessDate,context);assert.deepEqual(report.totals,today.totals);assert.equal(decorated,1);
  starts=[];rejectAuthority=true;await assert.rejects(getDailyPosReport(businessDate,context),/Denied/);assert.deepEqual(starts,[]);
});
