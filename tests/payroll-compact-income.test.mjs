import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const bundled=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {PayrollChangeHistory} from './app/payroll/payroll-change-history';export {payrollHistoryForStaff,payrollHistoryStaffLabel} from './lib/payroll-live-history-presentation';export const renderHistory=props=>renderToStaticMarkup(React.createElement(PayrollChangeHistory,props));`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react-dom/server','react/jsx-runtime'],alias:{'@':process.cwd()},plugins:[{name:'display-adapters',setup(b){b.onResolve({filter:/workspace-language$/},()=>({path:'language',namespace:'fixture'}));b.onResolve({filter:/financial-input-history\.module\.css$/},()=>({path:'css',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='language'?'export const WorkspaceText=({text})=>text;':'export default {};',loader:'tsx'}));}}]});
const module={exports:{}};new Function('module','exports','require',bundled.outputFiles[0].text)(module,module.exports,require);
const {renderHistory,payrollHistoryForStaff,payrollHistoryStaffLabel}=module.exports;
const uuid='0d4f2344-9fb4-4ee2-9123-22cc5564d568';
const event={id:uuid,salon_id:uuid,source_id:uuid,staff_id:null,source_table:'staff_day',period_start:'2026-10-01',period_end:'2026-10-01',created_at:'2026-10-29T16:00:00Z',actor_name:'Salon Owner',note:'Corrected paper total',before_values:{service_total:100,tip_amount:10},after_values:{service_total:120,tip_amount:12}};

test('gross and tip corrections render without calculated net snapshots, including fixed-pay unchanged net',()=>{
 const html=renderHistory({changes:[{...event,before_values:{...event.before_values,final_staff_income:500},after_values:{...event.after_values,final_staff_income:500}}]});
 assert.match(html,/Service sales/);assert.match(html,/\$100\.00/);assert.match(html,/\$120\.00/);assert.match(html,/\$10\.00/);assert.match(html,/\$12\.00/);assert.match(html,/Corrected paper total/);assert.doesNotMatch(html,/No recorded input/);assert.doesNotMatch(html,/\$500\.00/);
});
test('Daily Report history stays visible with service receipts and independently entered tip',()=>{
 const html=renderHistory({compact:true,changes:[{...event,source_table:'daily_report',before_values:{cash_amount:100,tip_input:null},after_values:{cash_amount:90,tip_input:10}}]});
 assert.match(html,/Daily Report/);assert.match(html,/Cash/);assert.match(html,/Entered tips/);assert.match(html,/\$90\.00/);assert.match(html,/\$10\.00/);
});
test('unchanged ticket reassignment shows both staff input changes and human service names',()=>{
 const change={...event,source_table:'ticket',note:'Reassigned manicure',before_values:{ticket_number:'T-24',service_total:100,tip_amount:10,lines:[{id:uuid,service_name:'Manicure',staff_id:uuid,staff_name:'Anna',service_total:100}]},after_values:{ticket_number:'T-24',service_total:100,tip_amount:10,lines:[{id:uuid,service_name:'Manicure',staff_id:uuid,staff_name:'Lily',service_total:100}]},staff_projections:[{staff_id:'anna',staff_name:'Anna',before_values:{service_total:100,tip_amount:10},after_values:{service_total:0,tip_amount:0}},{staff_id:'lily',staff_name:'Lily',before_values:{service_total:0,tip_amount:0},after_values:{service_total:100,tip_amount:10}}]};
 const html=renderHistory({changes:[change]});assert.match(html,/Anna input changes/);assert.match(html,/Lily input changes/);assert.match(html,/Services before/);assert.match(html,/Services after/);assert.match(html,/Manicure/);assert.match(html,/\$0\.00/);assert.doesNotMatch(html,/staff_id|service_id|source_id/);assert.doesNotMatch(html,new RegExp(uuid));
 const own=payrollHistoryForStaff([change],'anna');const ownHtml=renderHistory({changes:own});assert.equal(own[0].before_values.service_total,100);assert.equal(own[0].after_values.service_total,0);assert.doesNotMatch(ownHtml,/Lily|Services after/);assert.equal(payrollHistoryForStaff([change],'someone-else').length,0);
});
test('single Staff day projection does not duplicate identical parent values',()=>{
 const html=renderHistory({changes:[{...event,staff_projections:[{staff_id:uuid,staff_name:'Anna',before_values:event.before_values,after_values:event.after_values}]}]});
 assert.equal((html.match(/\$120\.00/g)??[]).length,1);assert.doesNotMatch(html,new RegExp(uuid));
});
test('settings history includes dated configuration and legal name without inferring income',()=>{
 const html=renderHistory({changes:[{...event,source_table:'payroll_settings',before_values:{commission_rate:60,legal_name:'Anna Old',effective_from:'2026-01-01'},after_values:{commission_rate:65,legal_name:'Anna Example',effective_from:'2026-10-01'}}]});
 assert.match(html,/Commission %/);assert.match(html,/Legal name/);assert.match(html,/Anna Example/);assert.match(html,/2026-10-01/);assert.doesNotMatch(html,/take-home|\$65/);
 assert.equal(payrollHistoryStaffLabel({...event,staff_snapshot:{id:uuid,displayName:'Anna'}},{}),'Anna');assert.equal(payrollHistoryStaffLabel({...event,staff_snapshot:{id:uuid,displayName:null}},{}),'Staff');
});
test('edited timestamp uses salon local time independently from the business date',()=>{
 const html=renderHistory({changes:[{...event,business_timezone:'Pacific/Honolulu'}]});
 assert.match(html,/Oct 29, 2026, 6:00 AM/);assert.match(html,/Business date/);assert.match(html,/2026-10-01/);
});
