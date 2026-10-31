import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['lib/inline-financial-history.ts'],bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()}});
const {financialHistoryForObject,financialHistoryMatchesObject}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const base={id:'e1',salon_id:'salon',staff_id:null,source_table:'ticket',source_id:'immutable-ticket',ticket_id:'immutable-ticket',period_start:'2020-10-01',period_end:'2020-10-01',created_at:'2026-10-31T01:00:00Z',actor_id:null,event_action:'updated',before_values:{service_total:40},after_values:{service_total:50}};
test('attaches edits by stable original object and business day, never edit timestamp',()=>{
 assert.equal(financialHistoryForObject([base],{ticketId:'immutable-ticket',businessDate:'2020-10-01'}).length,1);
 assert.equal(financialHistoryForObject([base],{ticketId:'other-ticket'}).length,0);
 assert.equal(financialHistoryForObject([base],{businessDate:'2026-10-31'}).length,0);
 assert.equal(financialHistoryForObject([{...base,source_id:'staff-event-id'}],{ticketId:'immutable-ticket'}).length,1);
});
test('creation, draft and semantic no-op never acquire an edited row',()=>{
 const rows=[{...base,id:'create',event_action:'created',before_values:{}},{...base,id:'draft',event_action:'draft'}, {...base,id:'same',before_values:{service_total:50,nested:{b:2,a:1}},after_values:{nested:{a:1,b:2},service_total:50}}];
 assert.deepEqual(financialHistoryForObject(rows),[]);
});
test('missing legacy classification remains visible but duplicate event projections count once',()=>{
 const legacy={...base,event_action:undefined};assert.equal(financialHistoryForObject([legacy,legacy]).length,1);
 for(const source_table of ['ticket','staff_payroll_settings','pos_ticket_staff_earnings'])assert.equal(financialHistoryForObject([{...legacy,source_table,before_values:{}}]).length,0,'An unknown original value does not prove an edit: '+source_table);
});
test('staff/day selector extracts only captured own projection and retains both sides of reassignment',()=>{
 const row={...base,staff_projections:[{staff_id:'Anna',staff_name:'Anna',before_values:{service_total:40,tip_amount:5},after_values:{service_total:0,tip_amount:0}},{staff_id:'Bella',staff_name:'Bella',before_values:{service_total:0,tip_amount:0},after_values:{service_total:40,tip_amount:5}}]};
 const anna=financialHistoryForObject([row],{staffId:'Anna'})[0],bella=financialHistoryForObject([row],{staffId:'Bella'})[0];
 assert.equal(anna.before_values.service_total,40);assert.equal(anna.after_values.service_total,0);assert.equal(anna.staff_projections,undefined);
 assert.equal(bella.before_values.service_total,0);assert.equal(bella.after_values.service_total,40);assert.equal(bella.staff_snapshot.displayName,'Bella');
 assert.equal(financialHistoryForObject([row],{staffId:'third'}).length,0);assert.equal(row.staff_projections.length,2);
});
test('period inputs use original range; kinds keep bonus/settings/ticket explanations on their object',()=>{
 const bonus={...base,source_table:'payroll_period_staff_inputs',period_end:'2020-10-15',before_values:{bonus_amount:10},after_values:{bonus_amount:20}};
 assert.equal(financialHistoryMatchesObject(bonus,{businessDate:'2020-10-10',sourceKinds:['payroll_period_staff_inputs']}),true);
 assert.equal(financialHistoryForObject([bonus],{sourceKinds:['ticket']}).length,0);
});
test('default zero bonus initialization is silent and explicit zero after a real value is retained',()=>{
 const bonus={...base,source_table:'payroll_period_staff_inputs',before_values:{},after_values:{bonus_amount:0}};
 assert.equal(financialHistoryForObject([bonus]).length,0);
 assert.equal(financialHistoryForObject([{...bonus,before_values:{bonus_amount:25}}]).length,1);
});
