import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

let fixture;
globalThis.__financialHistoryFixture=()=>fixture;
const mocks={
 'server-only':'',
 '@/lib/request-business-context':'export const getRequestBusinessContext=async()=>globalThis.__financialHistoryFixture().context;',
 '@/lib/current-context':'export const isSalonManageContext=context=>context.lane==="manage";export const isSalonStaffContext=context=>context.lane==="staff";',
 '@/lib/supabase/server':'export const createAuthenticatedSupabaseServerClient=async()=>globalThis.__financialHistoryFixture().client;',
 '@/lib/staff-account':'export const resolveStaffAccountForSalon=async()=>globalThis.__financialHistoryFixture().staffResult;',
 '@/lib/permissions':'export const hasPermission=async permission=>globalThis.__financialHistoryFixture().permissions.includes(permission);',
 '@/lib/salon-business-clock':'export const getContextBusinessDate=async()=>"2026-10-29";export const getContextBusinessTimezone=async()=>"America/Chicago";export const getSalonBusinessTimezone=async()=>globalThis.__financialHistoryFixture().timeZone??"America/Chicago";',
 '@/lib/daily-pos-report':'export const getUtcBoundsForLocalDate=()=>({openedFrom:"2026-10-29T05:00:00.000Z",openedTo:"2026-10-30T04:59:59.999Z"});',
 '@/lib/read-context-scope':'export const runWithReadContext=fn=>fn();',
};
const output=await build({stdin:{contents:`export {GET} from './app/api/financial-input-history/route';export {loadFinancialInputHistory} from './lib/financial-input-history';`,loader:'ts',resolveDir:process.cwd()},alias:{'@':process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'read-only-fixture',setup(b){b.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'ts'}));}}]});
const module={exports:{}};new Function('module','exports',output.outputFiles[0].text)(module,module.exports);
const {GET,loadFinancialInputHistory}=module.exports;

function clientFor(tables){
 const calls=[];
 return {calls,async rpc(name,{p_event_ids}){assert.equal(name,'get_financial_input_event_metadata');return {data:tables.financial_input_events.filter(row=>p_event_ids.includes(row.id)).map(row=>({event_id:row.id,event_action:row.event_action??(Object.keys(row.before_values).length===0?'created':'updated'),ticket_number:row.after_values.ticket_number??null})),error:null};},from(table){let filters=[],ordering=[],range=null;const call={table,filters,ordering,get range(){return range;}};calls.push(call);
  const data=()=>{let rows=[...(tables[table]??[])];for(const filter of filters){const [op,key,value]=filter;if(op==='eq')rows=rows.filter(row=>row[key]===value);if(op==='neq')rows=rows.filter(row=>row[key]!==value);if(op==='in')rows=rows.filter(row=>value.includes(row[key]));if(op==='gte')rows=rows.filter(row=>row[key]>=value);if(op==='lte')rows=rows.filter(row=>row[key]<=value);if(op==='lt')rows=rows.filter(row=>row[key]<value);if(op==='or')rows=rows.filter(row=>row.created_at<tables.financial_input_history_cutover[0].cutover_at||['payroll_period_staff_inputs','salon_payroll_settings'].includes(row.source_table));}
   rows.sort((a,b)=>{for(const [key,ascending]of ordering){const result=String(a[key]).localeCompare(String(b[key]));if(result)return ascending?result:-result;}return 0;});
   return range?rows.slice(range[0],Math.min(range[1]+1,range[0]+1000)):rows.slice(0,1000);};
  const q={select(){return q;},eq(key,value){filters.push(['eq',key,value]);return q;},neq(key,value){filters.push(['neq',key,value]);return q;},in(key,value){filters.push(['in',key,value]);return q;},gte(key,value){filters.push(['gte',key,value]);return q;},lte(key,value){filters.push(['lte',key,value]);return q;},lt(key,value){filters.push(['lt',key,value]);return q;},or(value){filters.push(['or',null,value]);return q;},order(key,options={}){ordering.push([key,options.ascending!==false]);return q;},range(a,b){range=[a,b];return q;},returns:async()=>({data:data(),error:null}),single:async()=>({data:data()[0]??null,error:null})};return q;
 }};
}
const event=(id,kind,staff_id,overrides={})=>({id,salon_id:'salon',staff_id,staff_name:staff_id==='anna'?'Anna':'Lily',kind,business_date:'2026-10-01',before_values:{service_total:100,tip_amount:10},after_values:{service_total:120,tip_amount:12},note:'Corrected entry',actor_name:'Salon Owner',created_at:'2026-10-29T16:00:00.000Z',...overrides});
function setup(lane='manage'){
 const tables={financial_input_events:[event('ticket','ticket'),event('day','staff_day'),event('setting','payroll_settings'),event('report','daily_report')],financial_input_event_staff:[event(undefined,'ticket','anna',{event_id:'ticket'}),event(undefined,'ticket','lily',{event_id:'ticket'}),event(undefined,'staff_day','anna',{event_id:'day'}),event(undefined,'payroll_settings','anna',{event_id:'setting'})],financial_input_history_cutover:[{cutover_at:'2026-10-28T00:00:00.000Z'}],payroll_live_change_history:[]};
 fixture={context:{lane,user:{id:'user'},currentSalon:{id:'salon'}},permissions:['tickets.view','reports.view','payroll.view'],staffResult:{status:'found',staff:{id:'anna'}},client:clientFor(tables),tables};return fixture;
}
const request=async query=>{const response=await GET(new Request('https://fixture.invalid/api/financial-input-history'+query));return {status:response.status,cache:response.headers.get('cache-control'),body:await response.json()};};

test('Staff Today shows own ticket projection; Staff Payroll excludes ticket events and shows daily inputs/settings',async()=>{
 setup('staff');let result=await request('?surface=today');assert.equal(result.status,200);assert.deepEqual(result.body.rows.map(row=>[row.id,row.staff_id,row.source_table]),[['ticket','anna','ticket']]);assert.equal(result.cache,'private, no-store');
 result=await request('?surface=payroll&start=2026-10-01&end=2026-10-29');assert.equal(result.status,200);assert.deepEqual(new Set(result.body.rows.map(row=>row.source_table)),new Set(['staff_day','payroll_settings']));assert.ok(result.body.rows.every(row=>row.staff_id==='anna'));assert.equal((await request('?surface=reports')).status,403);
});
test('Owner Today queries edit time, while notification business-date selection shows the original work date',async()=>{
 const f=setup();f.tables.financial_input_events.push(event('yesterday-edit','ticket',undefined,{business_date:'2026-10-29',created_at:'2026-10-28T23:00:00.000Z'}));
 let result=await request('?surface=today');assert.deepEqual(result.body.rows.map(row=>row.id),['ticket']);
 result=await request('?surface=today&date=2026-10-29');assert.deepEqual(result.body.rows.map(row=>row.id),['yesterday-edit']);
 result=await request('?surface=payroll&start=2026-10-01&end=2026-10-29');assert.equal(result.body.rows.length,5);assert.equal(result.body.rows.find(row=>row.id==='ticket').staff_projections.length,2);
});
test('date validation, account/salon scope and missing/ambiguous staff links reject before history queries',async()=>{
 let f=setup('staff');assert.equal((await request('?surface=payroll&start=2026-02-30')).status,400);assert.equal(f.client.calls.length,0);
 assert.equal((await request('?surface=today&salonId=another-salon')).status,403);assert.equal(f.client.calls.length,0);
 f.staffResult={status:'multiple',staff:null};assert.equal((await request('?surface=today')).status,403);assert.equal(f.client.calls.length,0);
 f=setup();f.permissions=[];assert.equal((await request('?surface=payroll')).status,403);assert.equal(f.client.calls.length,0);
 f.context.user=null;assert.equal((await request('?surface=today')).status,401);assert.equal(f.client.calls.length,0);
});
test('history keeps all 501 events and 1503 affected projections across PostgREST page caps',async()=>{
 const f=setup();f.tables.financial_input_events=[];f.tables.financial_input_event_staff=[];
 for(let i=0;i<501;i++){const id=`event-${String(i).padStart(4,'0')}`;f.tables.financial_input_events.push(event(id,'ticket'));for(const staff_id of ['anna','lily','kim'])f.tables.financial_input_event_staff.push(event(undefined,'ticket',staff_id,{event_id:id}));}
 const rows=await loadFinancialInputHistory(f.client,'salon','2026-10-01','2026-10-29',{surface:'payroll'});
 assert.equal(rows.length,501);assert.equal(new Set(rows.map(row=>row.id)).size,501);assert.equal(rows.reduce((sum,row)=>sum+row.staff_projections.length,0),1503);assert.ok(rows.every(row=>row.staff_projections.length===3));
 assert.ok(f.client.calls.filter(call=>call.table==='financial_input_events').every(call=>call.ordering.some(([key])=>key==='id')));
});
test('legacy income-source audits never leak into Staff Payroll and old missing totals stay raw',async()=>{
 const f=setup('staff');f.tables.financial_input_event_staff=[];
 f.tables.payroll_live_change_history=['pos_ticket_staff_earnings','pos_daily_closings','staff_payroll_settings'].map((source_table,i)=>({id:`legacy-${i}`,salon_id:'salon',staff_id:'anna',source_table,source_id:'source',period_start:'2026-10-01',period_end:'2026-10-29',before_values:{commission_rate:60},after_values:{commission_rate:65},actor_id:null,created_at:'2026-10-27T15:00:00Z'}));
 const result=await request('?surface=payroll&start=2026-10-01&end=2026-10-29');assert.equal(result.status,200);assert.equal(result.body.rows.length,1);assert.equal(result.body.rows[0].source_table,'staff_payroll_settings');assert.equal(result.body.rows[0].after_values.final_staff_income,undefined);
});
test('history timestamps use the selected salon timezone for new and retained older rows',async()=>{
 const f=setup();f.timeZone='Pacific/Honolulu';const result=await request('?surface=payroll&start=2026-10-01&end=2026-10-29');
 assert.equal(result.status,200);assert.ok(result.body.rows.every(row=>row.business_timezone==='Pacific/Honolulu'));
});

const focusedId='a0000000-1111-4111-8111-111111111111';
test('new and legacy ticket creation stay audited but never appear as edits on any default surface',async()=>{
 for(const lane of ['manage','staff']){
  const f=setup(lane);f.tables.financial_input_events=[event(focusedId,'ticket',undefined,{before_values:{},after_values:{ticket_number:'T00044',service_total:20,tip_amount:0}})];
  // Old Staff projections used zero inputs rather than {}. Parent metadata is authoritative.
  f.tables.financial_input_event_staff=[event(undefined,'ticket','anna',{event_id:focusedId,before_values:{service_total:0,tip_amount:0},after_values:{service_total:20,tip_amount:0}})];
  for(const surface of lane==='manage'?['today','reports','payroll']:['today','payroll']){
   const result=await request(`?surface=${surface}&start=2026-10-01&end=2026-10-29`);assert.equal(result.status,200);assert.deepEqual(result.body.rows,[]);assert.equal(result.body.record,undefined);
  }
  const receipt=await request(`?surface=today&inputEvent=${focusedId.toUpperCase()}`);assert.equal(receipt.status,200);assert.deepEqual(receipt.body.rows,[]);assert.equal(receipt.body.record.id,focusedId);assert.equal(receipt.body.record.event_action,'created');
  assert.equal(f.tables.financial_input_events.length,1);
 }
});
test('exact notification opens an old or future authorized event without changing the selected pay period',async()=>{
 const f=setup('staff');f.tables.financial_input_event_staff=[event(undefined,'payroll_settings','anna',{event_id:focusedId,business_date:'2030-01-01',created_at:'2026-10-01T01:00:00Z',before_values:{commission_rate:60},after_values:{commission_rate:65}})];
 const result=await request(`?surface=payroll&start=2026-10-01&end=2026-10-29&inputEvent=${focusedId}`);
 assert.equal(result.status,200);assert.equal(result.body.rows.length,1);assert.equal(result.body.rows[0].period_start,'2030-01-01');
 const foreign='b0000000-1111-4111-8111-111111111111';f.tables.financial_input_event_staff.push(event(undefined,'payroll_settings','lily',{event_id:foreign}));
 assert.equal((await request(`?surface=payroll&inputEvent=${foreign}`)).status,404);
 assert.equal((await request(`?surface=today&inputEvent=${focusedId}`)).status,404);
 assert.equal((await request('?inputEvent=invalid')).status,400);
});
test('legacy bonus notification addresses its original range and default zero initialization is silent',async()=>{
 const f=setup('staff');f.tables.financial_input_event_staff=[];
 const bonus={id:focusedId,salon_id:'salon',staff_id:'anna',source_table:'payroll_period_staff_inputs',source_id:'source',period_start:'2024-01-01',period_end:'2024-01-31',before_values:{bonus_amount:0},after_values:{bonus_amount:20},actor_id:null,created_at:'2026-10-27T15:00:00Z'};
 f.tables.payroll_live_change_history=[bonus];
 const result=await request(`?surface=payroll&inputEvent=${focusedId}`);assert.equal(result.status,200);assert.equal(result.body.rows[0].period_start,'2024-01-01');
 f.tables.payroll_live_change_history=[{...bonus,before_values:{},after_values:{bonus_amount:0}}];
 assert.deepEqual((await request('?surface=payroll&start=2024-01-01&end=2024-01-31')).body.rows,[]);
});
test('metadata failure cannot misclassify or expose an old Staff ticket projection',async()=>{
 const f=setup('staff');f.client.rpc=async()=>({data:[],error:null});
 assert.equal((await request('?surface=today')).status,503);
});
test('Owner and Staff hide initial draft steps and first submission while preserving reopened ticket edits',async()=>{
 for(const lane of ['manage','staff']){
  const f=setup(lane),draft=event(focusedId,'ticket',undefined,{event_action:'draft',before_values:{},after_values:{status:'open',service_total:20}});
  const submitted=event('b0000000-1111-4111-8111-111111111111','ticket',undefined,{event_action:'created',before_values:{status:'open',service_total:20},after_values:{status:'closed',service_total:20}});
  const changed=event('c0000000-1111-4111-8111-111111111111','ticket',undefined,{event_action:'updated',before_values:{status:'open',service_total:20},after_values:{status:'open',service_total:30}});
  f.tables.financial_input_events=[draft,submitted,changed];f.tables.financial_input_event_staff=[draft,submitted,changed].map(({id,...row})=>({...row,event_id:id,staff_id:'anna'}));
  const result=await request('?surface=today');assert.equal(result.status,200);assert.deepEqual(result.body.rows.map(row=>row.id),[changed.id]);
  assert.equal((await request(`?surface=today&inputEvent=${draft.id}`)).status,404);
  const first=await request(`?surface=today&inputEvent=${submitted.id}`);assert.equal(first.status,200);assert.equal(first.body.record.id,submitted.id);assert.deepEqual(first.body.rows,[]);
 }
});
test('Owner ticket context cannot be replaced with a dual-role own-Staff projection',async()=>{
 const f=setup();f.client.rpc=async(_name,{p_event_ids})=>({error:null,data:p_event_ids.map(event_id=>({event_id,event_action:'updated',before_context:{service_total:1},after_context:{service_total:2}}))});
 const result=await request('?surface=today');assert.equal(result.status,200);assert.equal(result.body.rows[0].before_values.service_total,100);assert.equal(result.body.rows[0].after_values.service_total,120);
});
