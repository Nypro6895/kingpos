import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundled=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:"export * from './lib/financial-change-presentation';export * from './lib/inline-financial-history';"},bundle:true,write:false,platform:'node',format:'esm'});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const {financialHistoryRecordKind:kind,hasMeaningfulFinancialInputChange:readable,financialHistoryForObject:edits,financialHistoryEarlierEvidenceForObject:earlier,periodPaymentDetailsForObject:payments,periodPaymentMetadataDetails:paymentDetails,describeFinancialInputChange:describe,capturedFinancialRecordFacts:facts}=api;
const base={id:'row',salon_id:'salon',staff_id:'Ny',source_id:'earning',source_table:'pos_ticket_staff_earnings',period_start:'2026-10-29',period_end:'2026-10-29',created_at:'2026-10-30T15:00:00Z',actor_id:null,before_values:{},after_values:{service_total:75,tip_amount:0,work_date:'2026-10-29'}};
test('missing and JSON-null prior money are retained evidence, while explicit zero proves a distinct prior amount',()=>{
 for(const before_values of [{},{service_total:null,tip_amount:null,work_date:null}]){const row={...base,before_values};assert.equal(kind(row),'earlier');assert.equal(readable(row),true);assert.deepEqual(edits([row]),[]);assert.equal(earlier([row]).length,1);const captured=facts(row);assert.ok(captured.some(d=>d.after==='$75.00'));assert.ok(captured.some(d=>d.after==='$0.00'));assert.ok(!captured.some(d=>d.label==='Business date'));}
 const explicit={...base,before_values:{service_total:0,tip_amount:0,work_date:'2026-10-29'}};assert.equal(kind(explicit),'change');assert.equal(edits([explicit]).length,1);
});
test('work date is context and context-only rewrites do not create an income edit',()=>{
 const row={...base,before_values:{service_total:75,tip_amount:0,work_date:null}};assert.equal(kind(row),'unchanged');assert.equal(readable(row),false);assert.deepEqual(edits([row]),[]);assert.ok(!describe(row).details.some(d=>d.label==='Business date'));
});
test('Daily Report captured not-entered is a known domain state; a missing field remains unknown',()=>{
 for(const source_table of ['daily_report','pos_daily_closings'])for(const amount of [0,20]){
  const row={...base,source_table,before_values:{tip_input:null},after_values:{tip_input:amount}};assert.equal(kind(row),'change');assert.equal(edits([row]).length,1);assert.match(describe(row).summary,new RegExp('Not entered → \\$'+amount+'\\.00'));assert.equal(describe(row).details[0].comparison,undefined);
  const missing={...row,before_values:{cash_amount:100},after_values:{cash_amount:100,tip_input:amount}};assert.equal(kind(missing),'earlier');assert.equal(describe(missing).details[0].comparison,'recorded');
 }
 const entered={...base,source_table:'daily_report',before_values:{entered:false,cash_amount:null,credit_card_amount:null,other_amount:null},after_values:{entered:true,cash_amount:0,credit_card_amount:20,other_amount:0}};assert.equal(kind(entered),'change');const details=describe(entered).details;assert.ok(details.some(d=>d.label==='Cash'&&d.before==='Not entered'&&d.after==='$0.00'&&!d.comparison));assert.ok(details.some(d=>d.label==='Card'&&d.before==='Not entered'&&d.after==='$20.00'&&!d.comparison));assert.equal(kind({...entered,event_action:'created'}),'created');
});
test('known draft and creation never acquire an Edited state, including non-ticket initialization',()=>{
 for(const source_table of ['ticket','staff_day','payroll_settings','daily_report','pos_ticket_staff_earnings','payroll_period_staff_inputs'])for(const event_action of ['created','draft']){const row={...base,source_table,event_action};assert.equal(kind(row),event_action);assert.deepEqual(edits([row]),[]);assert.deepEqual(earlier([row]),[]);assert.deepEqual(payments([row]),[]);}
 assert.equal(api.isFinancialInputCreation({...base,source_table:'payroll_settings',event_action:'created'}),false,'ticket-specific API creation contract remains unchanged');
 assert.equal(readable({...base,source_table:'payroll_settings',event_action:'created'}),true,'optional configured-setting focus facts remain readable');
});
test('real captured legacy edits remain valid and no current net-pay snapshots are inferred',()=>{
 const row={...base,before_values:{service_total:35,tip_amount:0,work_date:'2026-10-29'},after_values:{service_total:20,tip_amount:0,work_date:'2026-10-29'},final_staff_income:999};assert.equal(kind(row),'change');assert.equal(edits([row]).length,1);assert.match(describe(row).summary,/\$35\.00 → \$20\.00/);assert.doesNotMatch(describe(row).summary,/999|net|take.home/i);
});
test('check clearing/restoring and period notes are metadata; missing prior metadata remains unknown',()=>{
 const row={...base,source_table:'payroll_period_staff_inputs',before_values:{bonus_amount:0,check_number:'124',note:null},after_values:{bonus_amount:0,check_number:null,note:'Payroll copy'}};
 assert.equal(kind(row),'payment-details');assert.deepEqual(edits([row]),[]);assert.equal(payments([row],{staffId:'Ny'}).length,1);assert.equal(readable(row),true);assert.deepEqual(paymentDetails(row).map(d=>[d.label,d.before,d.after]),[['Check number','124','Not set'],['Period note','Not set','Payroll copy']]);
 const missing={...row,before_values:{bonus_amount:0}};assert.equal(kind(missing),'earlier');assert.deepEqual(payments([missing]),[]);assert.equal(paymentDetails(missing)[0].comparison,'recorded');
 const restored={...row,before_values:row.after_values,after_values:row.before_values};assert.equal(kind(restored),'payment-details');
});
test('a bonus edit with check metadata remains one income event and a separate neutral metadata projection',()=>{
 const row={...base,source_table:'payroll_period_staff_inputs',before_values:{bonus_amount:25,check_number:'124',note:null},after_values:{bonus_amount:0,check_number:null,note:'Updated copy'}};assert.equal(kind(row),'change');assert.equal(edits([row]).length,1);assert.equal(payments([row]).length,1);const presentation=describe(row);assert.match(presentation.summary,/Bonus: \$25\.00 → \$0\.00/);assert.doesNotMatch(presentation.summary,/124|Check number|Updated copy|Note/);
 assert.equal(kind({...row,before_values:{},after_values:{bonus_amount:0,check_number:null,note:''}}),'unchanged');
});
test('a confirmed field plus an unknown later amount keeps the known earlier amount without a false arrow',()=>{
 const row={...base,source_table:'ticket',before_values:{status:'closed',service_total:20,tip_amount:10,lines:[{id:'line',service_name:'Manicure',service_total:20}]},after_values:{status:'voided',service_total:null,tip_amount:null,lines:[{id:'line',service_name:'Manicure',service_total:null}]}};
 assert.equal(kind(row),'change');const details=[...describe(row).details,...describe(row).groups.flatMap(g=>g.details)];for(const label of ['Tips','Service amount']){const detail=details.find(d=>d.label===label);assert.equal(detail.comparison,'recorded');assert.equal(detail.recordedSide,'before');assert.match(api.financialChangeDetailText(detail),label==='Tips'?/\$10\.00/:/\$20\.00/);assert.doesNotMatch(api.financialChangeDetailText(detail),/→/);}
});
test('ticket service names, allocation, split, note and status stay legitimate edits without changing money',()=>{
 const old={id:'line',service_name:'Manicure',service_total:50,staff_name:'Ny',parts:[50],notes:null},next={...old,service_name:'Pedicure',staff_name:'Anna',parts:[25,25],notes:'Corrected service'};
 const row={...base,source_table:'ticket',before_values:{service_total:50,tip_amount:0,status:'closed',notes:null,lines:[old]},after_values:{service_total:50,tip_amount:0,status:'open',notes:'Receipt note',lines:[next]}};assert.equal(kind(row),'change');assert.equal(edits([row]).length,1);assert.match(describe(row).summary,/Manicure → Pedicure/);
});
test('own projection selectors never borrow another staff member or parent financial facts',()=>{
 const row={...base,source_table:'ticket',ticket_id:'ticket',staff_id:null,before_values:{service_total:999},after_values:{service_total:1000},staff_projections:[{staff_id:'Ny',staff_name:'Ny',before_values:{service_total:null},after_values:{service_total:75}},{staff_id:'Anna',staff_name:'Anna',before_values:{service_total:9999},after_values:{service_total:9998}}]};assert.deepEqual(edits([row],{staffId:'Ny'}),[]);const own=earlier([row],{staffId:'Ny'})[0];assert.equal(own.after_values.service_total,75);assert.equal(own.staff_projections,undefined);assert.doesNotMatch(JSON.stringify(own),/9999|9998/);
});
