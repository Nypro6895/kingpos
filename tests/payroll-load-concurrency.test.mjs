import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
const dir='artifacts/owner-payroll-polish';fs.mkdirSync(dir,{recursive:true});
const extract=source=>{const ast=ts.createSourceFile('payroll.ts',source,ts.ScriptTarget.Latest,true);return ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='getPayrollPageData').getText(ast)};
const baseline=extract(execFileSync('git',['show','4931ef6:lib/payroll.ts'],{encoding:'utf8'}));
const current=extract(fs.readFileSync('lib/payroll.ts','utf8'));
function fixture(source,{owner=true,failShop=false,delay=12}={}){
 const calls=[],staff=[{id:'staff',name:'Kim'}],settings=[{staff_id:'staff'}],schedule={cycle_type:'monthly'},period={startDate:'2026-10-01',endDate:'2026-10-31'},live={lines:[{staff_id:'staff',final_cash_amount:100,final_check_amount:200}],shopSummary:{taxWithheld:50}},shop={days:[],today:'2026-11-01',timezone:'America/Chicago'};
 const read=async(name,result)=>{calls.push({name,at:performance.now()});await new Promise(r=>setTimeout(r,delay));return result};
 const context={currentMembership:{role_code:owner?'OWNER':'MANAGER'}};
 const auth={access:{canViewAllPayroll:true},Account:{id:'account'},salon:{id:'salon'},context,supabase:{rpc:async(name,args)=>{assert.equal(args.p_salon,'salon');return read('shop',{data:shop,error:failShop?{message:'offline'}:null});}}};
 const deps={
 requirePayrollContext:()=>read('auth',auth),loadSalonPayrollSetting:()=>read('schedule',schedule),getDefaultSalonPayrollSetting:()=>schedule,getSalonBusinessTimezone:()=>read('timezone','America/Chicago'),resolvePayrollPeriod:()=>period,
 loadStaffRows:()=>read('staff',staff),loadStaffPayrollSettings:()=>read('settings',settings),
 calculateLivePayrollForAuth:async(_auth,_period,seed={})=>{await Promise.all([seed.staffRows??deps.loadStaffRows(),seed.staffSettings??deps.loadStaffPayrollSettings(),seed.salonSetting??deps.loadSalonPayrollSetting()]);return read('live',live)},
 loadLatestPayrollSnapshot:()=>read('statement',null),loadPayrollServiceAnalytics:()=>read('analytics',{services:[]}),emptyPayrollServiceAnalytics:()=>({services:[]}),
 loadPayrollLiveHistory:()=>read('history',[{id:'event'}]),loadPayrollRecordedFacts:()=>read('recorded',{checks:[]}),loadPayrollIssuedChecks:()=>read('issued',{status:'available',checks:[{id:'issued-check'}]}),compareLivePayrollToStatement:()=>({changed:false}),
 buildTaxCompanyLinesForAuth:async({live})=>({lines:live.lines,summary:{tax:50}}),getStaffPresentationsByStaffId:()=>read('presentations',new Map()),getPayrollPeriodOptions:()=>[],getPayrollScheduleSetup:()=>({}),latestSettingsWithStaff:()=>settings,getPayrollStatusView:()=>({kind:'live'}),isOwnerMembership:m=>m.role_code==='OWNER',
 };
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,exports={};new Function('exports',...Object.keys(deps),code)(exports,...Object.values(deps));
 return{calls,run:input=>exports.getPayrollPageData(input),shop};
}
test('shared reads run once; canonical Payroll values equal the previous implementation',async()=>{
 const old=fixture(baseline,{delay:1}),next=fixture(current,{delay:1});
 const a=await old.run({includeAnalytics:false}),b=await next.run({includeAnalytics:false});const {shopMoney,issuedChecks,...rest}=b;
 assert.deepEqual(rest,a);assert.equal(shopMoney,null);assert.deepEqual(issuedChecks,{status:'available',checks:[]});assert.equal(next.calls.some(x=>x.name==='issued'),false);
 for(const name of ['timezone','schedule','staff','settings'])assert.equal(next.calls.filter(x=>x.name===name).length,1,name);
 const liveAt=next.calls.find(x=>x.name==='live').at;
 for(const name of ['history','recorded','statement'])assert.ok(next.calls.find(x=>x.name===name).at<liveAt,name+' should start independently');
});
test('issued references load only when requested by the admitted salon Owner',async()=>{
 const owner=fixture(current,{delay:1});assert.deepEqual((await owner.run({includeAnalytics:false,includeCheckReferences:true})).issuedChecks,{status:'available',checks:[{id:'issued-check'}]});assert.equal(owner.calls.filter(x=>x.name==='issued').length,1);
 const manager=fixture(current,{owner:false,delay:1});assert.deepEqual((await manager.run({includeAnalytics:false,includeCheckReferences:true})).issuedChecks,{status:'available',checks:[]});assert.equal(manager.calls.some(x=>x.name==='issued'),false);
});
test('Shop preloads only for an authorized owner and failures stay explicit',async()=>{
 const owner=fixture(current,{delay:1});assert.deepEqual((await owner.run({includeAnalytics:false,includeShopMoney:true})).shopMoney,{data:owner.shop,error:null});
 const manager=fixture(current,{owner:false,delay:1});assert.equal((await manager.run({includeAnalytics:false,includeShopMoney:true})).shopMoney,null);assert.equal(manager.calls.some(x=>x.name==='shop'),false);
 const failed=fixture(current,{failShop:true,delay:1});const result=await failed.run({includeAnalytics:false,includeShopMoney:true});assert.equal(result.live.lines[0].final_cash_amount,100);assert.equal(result.shopMoney.data,null);assert.match(result.shopMoney.error,/could not load/);
});
test('source load benchmark compares identical delayed backend boundaries',async()=>{
 const samples=[];
 for(let i=0;i<5;i++){
  const old=fixture(baseline),start=performance.now();await old.run({includeAnalytics:false});await new Promise(r=>setTimeout(r,12));const before=performance.now()-start;
  const next=fixture(current),startNext=performance.now();await next.run({includeAnalytics:false,includeShopMoney:true});const after=performance.now()-startNext;
  samples.push({beforeMs:Math.round(before),afterMs:Math.round(after)});
 }
 const median=key=>samples.map(x=>x[key]).sort((a,b)=>a-b)[2],beforeMs=median('beforeMs'),afterMs=median('afterMs');
 assert.ok(afterMs<beforeMs*.8,JSON.stringify({beforeMs,afterMs}));
 fs.writeFileSync(dir+'/load-benchmark.json',JSON.stringify({kind:'controlled source benchmark; simulated 12ms read boundaries; not live iPhone timing',samples,median:{beforeMs,afterMs},reductionPercent:Math.round((1-afterMs/beforeMs)*100)},null,2));
 console.log('Controlled source benchmark:',beforeMs,'→',afterMs,'ms');
});
