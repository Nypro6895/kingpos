import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const bundled=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {PayrollChangeHistory} from './app/payroll/payroll-change-history';export * from './lib/financial-change-presentation';export const render=props=>renderToStaticMarkup(React.createElement(PayrollChangeHistory,props));`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react-dom/server','react/jsx-runtime'],alias:{'@':process.cwd()},plugins:[{name:'display-adapters',setup(b){b.onResolve({filter:/workspace-language$/},()=>({path:'language',namespace:'fixture'}));b.onResolve({filter:/financial-input-history\.module\.css$/},()=>({path:'css',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='language'?'export const WorkspaceText=({text})=>text;':'export default {};',loader:'tsx'}));}}]});
const module={exports:{}};new Function('module','exports','require',bundled.outputFiles[0].text)(module,module.exports,require);
const {render,describeFinancialInputChange:describe,isFinancialInputCreation,hasMeaningfulFinancialInputChange}=module.exports;
const id='0d4f2344-9fb4-4ee2-9123-22cc5564d568';
const base={id,salon_id:id,staff_id:null,source_id:id,source_table:'ticket',period_start:'2026-10-01',period_end:'2026-10-01',created_at:'2026-10-30T01:00:00Z',business_timezone:'America/Chicago',actor_id:id,actor_name:'Salon Owner',note:'Corrected receipt',before_values:{ticket_number:'104',status:'closed',service_total:40,tip_amount:5},after_values:{ticket_number:'104',status:'closed',service_total:50,tip_amount:5}};
const event=(before,after,extra={})=>({...base,before_values:before,after_values:after,...extra});
const line=(key,name='Manicure',amount=40,staff='Anna')=>({id:key,service_name:name,service_total:amount,staff_name:staff,unit_price:amount,quantity:1,parts:[amount]});

test('creation-only and unchanged default bonus render no history module; first configuration and report entry remain meaningful',()=>{
 const created={...base,event_action:'created',before_values:{},after_values:{...base.after_values,lines:[line(id)]}};
 assert.equal(isFinancialInputCreation(created),true);assert.equal(render({changes:[created],compact:true}),'');assert.equal(render({changes:[]}), '');
 const setting=event({}, {commission_rate:60,effective_from:'2026-10-01'}, {source_table:'payroll_settings',event_action:'created'});
 assert.equal(isFinancialInputCreation(setting),false);assert.match(describe(setting).title,/configured/);assert.match(render({changes:[setting]}),/Commission: — → 60%/);
 const report=event({}, {cash_amount:0,tip_input:null,entered:true}, {source_table:'daily_report',event_action:'created'});assert.match(describe(report).title,/entered/);assert.match(describe(report).summary,/Cash: — → \$0\.00/);
 const bonus=event({}, {bonus_amount:0,check_number:null,note:''}, {source_table:'payroll_period_staff_inputs'});assert.equal(hasMeaningfulFinancialInputChange(bonus),false);assert.equal(render({changes:[bonus],compact:true}),'');
 const draft=event({}, {ticket_number:'104',status:'open',service_total:40},{event_action:'draft'});assert.equal(isFinancialInputCreation(draft),false);assert.equal(hasMeaningfulFinancialInputChange(draft),false);assert.equal(render({changes:[draft],compact:true}),'');
 const firstCheckout=event({ticket_number:'104',status:'open',service_total:40},{ticket_number:'104',status:'closed',service_total:40},{event_action:'created'});assert.equal(isFinancialInputCreation(firstCheckout),true);assert.equal(render({changes:[firstCheckout],compact:true}),'');
 const reopened=event({ticket_number:'104',status:'closed'},{ticket_number:'104',status:'open'},{event_action:'updated'});assert.equal(hasMeaningfulFinancialInputChange(reopened),true);assert.match(describe(reopened).summary,/Completed → Open/);
});

test('ticket summary immediately explains the actual service price while derived take-home snapshots stay invisible',()=>{
 const before={...base.before_values,lines:[line(id)]},after={...base.after_values,lines:[line(id,'Manicure',50)]};
 const edited=event({...before,final_staff_income:500},{...after,final_staff_income:500});
 const summary=render({changes:[edited]}).split('</summary>')[0];assert.match(summary,/Ticket 104/);assert.match(summary,/Manicure: \$40\.00 → \$50\.00/);assert.match(summary,/<svg/);assert.doesNotMatch(summary,/Ticket inputs|\$500|UUID/);
 const details=describe(edited).groups.flatMap(group=>group.details);assert.ok(details.some(d=>d.label==='Service amount'&&d.before==='$40.00'&&d.after==='$50.00'));assert.doesNotMatch(render({changes:[edited]}),new RegExp(id));
});

test('names, quantities and service splits remain visible when the ticket total does not change',()=>{
 const before={ticket_number:'104',service_total:80,lines:[{...line(id,'Manicure',80),unit_price:40,quantity:2,parts:[40,40]}]},after={ticket_number:'104',service_total:80,lines:[{...line(id,'Pedicure',80),unit_price:20,quantity:4,parts:[20,20,20,20]}]};
 const presentation=describe(event(before,after));assert.match(presentation.summary,/Service name: Manicure → Pedicure/);
 const details=presentation.groups[0].details;assert.ok(details.some(d=>d.label==='Quantity'&&d.before==='2'&&d.after==='4'));assert.ok(details.some(d=>d.label==='Service split'&&d.before==='$40.00 + $40.00'&&d.after==='$20.00 + $20.00 + $20.00 + $20.00'));assert.ok(details.some(d=>d.label==='Unit price'&&d.after==='$20.00'));
});

test('added and removed services match stable internal line identities, without inventing changes to an unchanged neighbor',()=>{
 const edited=event({ticket_number:'104',lines:[line(id,'Manicure',40),line('neighbor','Pedicure',60)]},{ticket_number:'104',lines:[line('neighbor','Pedicure',60),line('added','Nail repair',10)]});
 const presentation=describe(edited);assert.match(presentation.summary,/Manicure removed: \$40\.00/);assert.match(presentation.summary,/Nail repair added: \$10\.00/);assert.equal(presentation.groups.length,2);assert.doesNotMatch(presentation.summary,/Pedicure/);
});

test('reassignment exposes both affected Staff to Owner, while an own projection never borrows parent or coworker money',()=>{
 const edited=event({ticket_number:'104',lines:[line(id,'Manicure',40,'Anna')]},{ticket_number:'104',lines:[line(id,'Manicure',40,'Lily')]},{staff_projections:[{staff_id:'anna',staff_name:'Anna',before_values:{service_total:40,tip_amount:5},after_values:{service_total:0,tip_amount:0}},{staff_id:'lily',staff_name:'Lily',before_values:{service_total:0,tip_amount:0},after_values:{service_total:40,tip_amount:5}}]});
 assert.match(describe(edited).summary,/Manicure staff: Anna → Lily/);assert.match(render({changes:[edited]}),/Anna input changes/);assert.match(render({changes:[edited]}),/Lily input changes/);
 const own=event({ticket_number:'104',service_total:40,tip_amount:5,lines:[line(id)]},{ticket_number:'104',service_total:0,tip_amount:0,lines:[]},{staff_id:'anna',staff_snapshot:{id:'anna',displayName:'Anna'},staff_projections:edited.staff_projections});
 assert.match(describe(own).summary,/Manicure removed from your work/);assert.doesNotMatch(render({changes:[own]}),/Lily|staff_totals/);
});

test('Staff ticket-wide discount, tax or note changes are explained by safe flags without shared ticket amounts',()=>{
 const own=event({ticket_number:'104',service_total:40,tip_amount:5,status:'closed'},{ticket_number:'104',service_total:40,tip_amount:5,status:'closed',ticket_changes:['discount','tax','note']},{staff_id:'anna'});
 const presentation=describe(own);assert.equal(presentation.incomplete,false);assert.match(presentation.summary,/Ticket discount changed/);assert.match(presentation.summary,/Ticket tax changed/);assert.match(presentation.summary,/Ticket note updated/);assert.doesNotMatch(presentation.summary,/\$|income|payroll/);
});

test('tip, discount, ticket status and reason are distinct from take-home and actual payroll payments',()=>{
 const edited=event({ticket_number:'104',tip_amount:5,discount_type:'fixed_amount',discount_value:0,discount_amount:0,status:'closed'},{ticket_number:'104',tip_amount:8,discount_type:'fixed_amount',discount_value:10,discount_amount:10,status:'voided'});
 const presentation=describe(edited);assert.match(presentation.summary,/Tips: \$5\.00 → \$8\.00/);assert.ok(presentation.details.some(d=>d.label==='Customer discount'&&d.after==='$10.00'));assert.ok(presentation.details.some(d=>d.label==='Ticket status'&&d.after==='Voided'));
 const html=render({changes:[{...edited,note:'<script>literal reason</script>'}]});assert.match(html,/Reason \/ note/);assert.match(html,/Edited by/);assert.match(html,/Business date/);assert.match(html,/Oct 29, 2026, 8:00 PM/);assert.match(html,/&lt;script&gt;literal reason&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>/);
});

test('Daily gross, settings, bonus, closing and actual payment presentations use only their own recorded meaning',()=>{
 const daily=describe(event({service_total:100,tip_amount:10},{service_total:110,tip_amount:12},{source_table:'staff_day'}));assert.match(daily.summary,/Service sales: \$100\.00 → \$110\.00/);assert.match(daily.summary,/Tips: \$10\.00 → \$12\.00/);
 const setting=describe(event({commission_rate:60,tax_rate:0,check_rate:50,effective_from:'2026-01-01'},{commission_rate:65,tax_rate:10,check_rate:40,effective_from:'2026-10-01'},{source_table:'payroll_settings'}));assert.match(setting.summary,/60% → 65%/);assert.ok(setting.details.some(d=>d.label==='Effective from'&&d.after==='2026-10-01'));assert.doesNotMatch(setting.summary,/income|take-home/);
 const bonus=event({bonus_amount:25},{bonus_amount:0},{source_table:'payroll_period_staff_inputs'});assert.equal(hasMeaningfulFinancialInputChange(bonus),true);assert.match(describe(bonus).summary,/Bonus: \$25\.00 → \$0\.00/);
 const closing=describe(event({cash_amount:100,tip_input:null},{cash_amount:90,tip_input:0},{source_table:'daily_report'}));assert.match(closing.summary,/Cash: \$100\.00 → \$90\.00/);assert.match(closing.summary,/Entered tips: — → \$0\.00/);
 const payment=describe(event({}, {cash_amount:100,check_amount:200,paid_at:'2026-10-30T12:00:00Z'},{source_table:'payroll_live_recorded_payments'}));assert.equal(payment.title,'Payroll payment recorded');assert.equal(payment.summary,'Cash $100.00 · Check $200.00');assert.ok(payment.details.some(d=>d.label==='Paid at'));assert.doesNotMatch(payment.summary,/income changed|take-home/);
});

test('POS payment changes and incomplete legacy records do not imply historical payroll income',()=>{
 const payment=describe(event({ticket_number:'104',payments:[],recorded_payment_total:0},{ticket_number:'104',payments:[{id,method:'cash',amount:50}],recorded_payment_total:50}));assert.match(payment.summary,/Ticket payment recorded: Cash \$50\.00/);assert.doesNotMatch(payment.summary,/Payroll payment/);
 const legacy=event({unexpected_technical_id:id},{unexpected_technical_id:'other'},{source_table:'pos_ticket_staff_earnings'});const presentation=describe(legacy);assert.equal(presentation.incomplete,true);assert.match(render({changes:[legacy]}),/Historical take-home impact is not inferred/);assert.doesNotMatch(render({changes:[legacy]}),/unexpected_technical_id/);
});

test('a focused event beyond the first ten entries is rendered and identified without exposing identifiers as text',()=>{
 const changes=Array.from({length:15},(_,index)=>({...base,id:`event-${index}`,before_values:{tip_amount:index},after_values:{tip_amount:index+1},staff_id:'anna'}));
 const html=render({changes,compact:true,focusedEventId:'event-14'});assert.match(html,/data-focused="true"/);assert.match(html,/Tips: \$14\.00 → \$15\.00/);assert.doesNotMatch(html,/>event-14</);
});
