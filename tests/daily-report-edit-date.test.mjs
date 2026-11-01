import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const {outputFiles}=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:"export * from './lib/financial-change-presentation';export * from './lib/inline-financial-history';"},bundle:true,write:false,platform:'node',format:'esm'});
const {financialHistoryForObject:edits,financialHistoryRecordKind:kind,hasMeaningfulFinancialInputChange:readable,isConfirmedFinancialInputChange:edited}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const base={id:'card-entry',salon_id:'salon',staff_id:null,source_table:'daily_report',source_id:'closing',period_start:'2026-11-01',period_end:'2026-11-01',created_at:'2026-11-01T18:39:00Z',business_timezone:'America/Chicago',actor_id:null,event_action:'updated',before_values:{cash_amount:25,credit_card_amount:0,other_amount:0,tip_input:null,entered:true,note:null},after_values:{cash_amount:25,credit_card_amount:86,other_amount:0,tip_input:null,entered:true,note:null}};

for(const source_table of ['daily_report','pos_daily_closings']){
 test(`${source_table}: first Card entry and further same-day saves do not show Edited`,()=>{
  const first={...base,source_table};
  const later={...first,id:'card-recount',before_values:first.after_values,after_values:{...first.after_values,credit_card_amount:90},created_at:'2026-11-02T05:59:59Z'};
  for(const row of [first,later]){
   assert.equal(kind(row),'change','Captured history remains a real saved change.');
   assert.equal(readable(row),true,'Do not discard audit records.');
   assert.equal(edited(row),false);
  }
  assert.deepEqual(edits([first,later]),[]);
 });
 test(`${source_table}: local midnight after the report date starts Edited`,()=>{
  const row={...base,source_table,created_at:'2026-11-02T06:00:00Z'};
  assert.equal(edited(row),true);
  assert.equal(edited({...row,created_at:'2026-12-02T06:00:00Z'}),true);
  assert.equal(edited({...row,created_at:'2026-11-01T04:59:59Z'}),false);
  assert.equal(edited({...row,created_at:'2026-11-02T00:00:00-06:00'}),true);
 });
}
test('salon timezone determines the boundary across DST and UTC date differences',()=>{
 for(const [period_start,business_timezone,lastSameDay,firstNextDay] of [
  ['2026-07-25','America/Chicago','2026-07-26T04:59:59Z','2026-07-26T05:00:00Z'],
  ['2026-11-01','America/Chicago','2026-11-02T05:59:59Z','2026-11-02T06:00:00Z'],
  ['2026-03-08','America/Chicago','2026-03-09T04:59:59Z','2026-03-09T05:00:00Z'],
  ['2026-11-01','Asia/Ho_Chi_Minh','2026-11-01T16:59:59Z','2026-11-01T17:00:00Z'],
  ['2026-11-01','UTC','2026-11-01T23:59:59Z','2026-11-02T00:00:00Z'],
 ]){
  const row={...base,period_start,period_end:period_start,business_timezone};
  assert.equal(edited({...row,created_at:lastSameDay}),false,`${business_timezone} same day`);
  assert.equal(edited({...row,created_at:firstNextDay}),true,`${business_timezone} next day`);
 }
});
test('only post-date saves contribute to Edited count for the original report',()=>{
 const initial={...base,id:'initial',event_action:'created',before_values:{}};
 const correction={...base,id:'next-day',created_at:'2026-11-02T06:00:00Z'};
 const result=edits([initial,base,correction,correction],{businessDate:'2026-11-01',sourceKinds:['daily_report','pos_daily_closings']});
 assert.deepEqual(result.map(row=>row.id),['next-day']);
 assert.deepEqual(edits([correction],{businessDate:'2026-11-02'}),[]);
});
test('creation, draft and unchanged saves remain silent after the report date',()=>{
 const row={...base,created_at:'2026-11-02T18:39:00Z'};
 for(const event_action of ['created','draft'])assert.equal(edited({...row,event_action}),false);
 assert.equal(edited({...row,before_values:row.after_values}),false);
});
test('Ticket edits and other financial edits retain their same-day behavior',()=>{
 for(const source_table of ['ticket','staff_day','payroll_settings']){
  const row={...base,source_table};
  assert.equal(edited(row),true);
  assert.equal(edited({...row,business_timezone:undefined}),true);
  assert.equal(edits([row]).length,1);
 }
 assert.equal(edited({...base,source_table:'ticket',event_action:'created',before_values:{}}),false);
});
test('unknown or invalid clock evidence cannot establish a post-date edit',()=>{
 for(const extra of [{business_timezone:undefined},{business_timezone:'Invalid/Zone'},{created_at:'invalid'},{period_start:'2026-02-30'},{period_start:'2026-1-1'}])assert.equal(edited({...base,created_at:'2026-11-03T12:00:00Z',...extra}),false);
});
