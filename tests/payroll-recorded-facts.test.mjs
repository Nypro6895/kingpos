import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const result=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {PayrollRecordedFactsPanel} from './app/payroll/payroll-recorded-facts';export {recordedPayrollRows} from './lib/payroll-recorded-export';export const render=props=>renderToStaticMarkup(React.createElement(PayrollRecordedFactsPanel,props));`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react-dom/server','react/jsx-runtime'],alias:{'@':process.cwd()},plugins:[{name:'translation-fixture',setup(b){b.onResolve({filter:/workspace-language$/},()=>({path:'language',namespace:'fixture'}));b.onResolve({filter:/ledger-actions$/},()=>({path:'actions',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='language'?'export const WorkspaceText=({text})=>text;':'export const saveOwnerAdjustment=async()=>{};export const saveRecordedPayment=async()=>{};export const verifyPayrollIntent=async()=>{};',loader:'tsx'}));}}]});
const module={exports:{}};new Function('module','exports','require',result.outputFiles[0].text)(module,module.exports,require);
const {render,recordedPayrollRows}=module.exports;
const staff='0d4f2344-9fb4-4ee2-9123-22cc5564d568',payment='38821aaa-0000-4000-8000-000000000001';
const base={id:'base',periodStart:'2026-10-01',periodEnd:'2026-10-15'};
const paid={id:payment,staff_id:staff,request_id:'request',actor_id:'owner',cash_amount:100,check_amount:200,paid_at:'2026-10-20T12:00:00Z',recorded_at:'2026-10-20T12:01:00Z',note:'Original recorded payment',revision_at_payment:0};
const period={base,revision:1,adjustments:[],payments:[paid],legacyPaidHistory:[{runId:'old-run',version:1,paidAt:'2026-10-16T12:00:00Z'}]};

test('payment evidence keeps actual amounts and paid date separate from paid flags without rendering IDs',()=>{
 const html=render({facts:{status:'available',periods:[period]},showExports:false});
 assert.match(html,/Staff member/);assert.match(html,/Recorded cash/);assert.match(html,/\$100\.00/);assert.match(html,/\$200\.00/);
 assert.match(html,/10\/20\/2026/);assert.match(html,/Original recorded payment/);assert.match(html,/not imported as cash payments/);
 assert.doesNotMatch(html,new RegExp(staff));assert.doesNotMatch(html,new RegExp(payment));assert.doesNotMatch(html,/old-run|base|request/);
 const blank=render({facts:{status:'available',periods:[period]},staffNames:{[staff]:'  '},showExports:false});assert.match(blank,/Staff member/);
});

test('historical paid flags do not synthesize payments and overlapping period evidence deduplicates original receipts',()=>{
 const rows=recordedPayrollRows({status:'available',periods:[period,period]});assert.equal(rows.payments.length,1);assert.equal(rows.payments[0][5],100);assert.equal(rows.payments[0][6],200);assert.equal(rows.payments[0][7],paid.paid_at);assert.equal(rows.payments[0][2],base.periodStart);assert.equal(rows.payments[0][3],base.periodEnd);
 const html=render({facts:{status:'available',periods:[{...period,payments:[]}]},showExports:false});assert.match(html,/0 recorded payments/);assert.doesNotMatch(html,/Recorded cash|\$100\.00|\$200\.00/);
 assert.equal(recordedPayrollRows({status:'unavailable',message:'Unavailable'}),null);
});

test('Staff evidence panel compares current calculated pay with original actual payments without exposing any payment editor',()=>{
 const facts={status:'available',selection:{start:base.periodStart,end:base.periodEnd,exact:true},periods:[period]},line={staff_id:staff,final_staff_income:350},selected={startDate:base.periodStart,endDate:base.periodEnd};
 const increased=render({facts,line,period:selected,showExports:false});assert.match(increased,/Current calculated pay/);assert.match(increased,/\$350\.00/);assert.match(increased,/Actual recorded payments/);assert.match(increased,/\$300\.00/);assert.match(increased,/Amount still owed/);assert.match(increased,/\$50\.00/);assert.doesNotMatch(increased,/<form|Record actual payment|Final cash income/);
 const decreased=render({facts,line:{...line,final_staff_income:250},period:selected,showExports:false});assert.match(decreased,/Recorded overpayment/);assert.match(decreased,/No refund or future deduction/);assert.doesNotMatch(decreased,new RegExp(staff));
});
