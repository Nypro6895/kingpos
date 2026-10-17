import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPayrollCalculation} from './helpers/payroll-calculation-loader.mjs';
const api=loadPayrollCalculation();
const source={start:'2026-10-01',end:'2026-10-02'};
const values={final_cash_amount:40,final_check_amount:60,tax_withheld:10,tax_company_taxable_gross:110,tax_company_cash_amount:40,staff_legal_name_snapshot:'Synthetic Staff',check_number:null};
function fixture(){
 const fields=Object.fromEntries(api.PAYROLL_ADDITIVE_FIELDS.map(k=>[k,0]));
 const day=date=>({...fields,businessDate:date,final_cash_amount:20,final_check_amount:30,final_staff_income:50,tax_withheld:5,earned_amount:55});
 return {base:{id:'base',periodStart:source.start,periodEnd:source.end},revision:2,lines:[{...fields,...values,staff_id:'staff',staff_display_name_snapshot:'Synthetic Staff',final_staff_income:100,earned_amount:110,dailyIncome:[day(source.start),day(source.end)],dailyTotals:[]}],adjustments:[{id:'a',base_id:'base',staff_id:'staff',revision:1,request_id:'adjust',actor_id:'owner',reason:'Fixture correction',before_values:values,after_values:{...values,final_cash_amount:45},delta_amount:5,created_at:'2026-10-04T12:00:00Z'}],payments:[{id:'p',staff_id:'staff',request_id:'paid',actor_id:'owner',cash_amount:40,check_amount:60,paid_at:'2026-10-05T12:00:00Z',recorded_at:'2026-10-05T12:01:00Z',revision_at_payment:1,note:'Already paid fixture'}]};
}
test('Partial income ranges never compare partial income with whole-period payments or duplicate payment CSV',()=>{
 const line=api.projectPayrollLedger(fixture())[0];
 const first=api.slicePayrollReportLine(line,source,{start:source.start,end:source.start});
 const last=api.slicePayrollReportLine(line,source,{start:source.end,end:source.end});
 const total=api.groupPayrollReportLines([first,last])[0];
 for(const part of[first,last,total]){assert.equal(part.ledger.paid,null);assert.equal(part.ledger.balance,null);assert.equal(part.ledger.paymentPeriods.length,1);assert.equal(part.ledger.paymentPeriods[0].paid,100);}
 assert.equal(total.ledger.payments.length,1);assert.equal(total.ledger.originalIncome,100);assert.equal(total.final_staff_income,105);
 const csv=api.payrollPaymentExport([first,last],source);assert.equal(csv.length,1);assert.equal(csv[0][8],100);assert.equal(csv[0][9],'2026-10-05T12:00:00Z');assert.match(csv[0][5],/not filtered by payment date/);
 const whole=api.slicePayrollReportLine(line,source,source);assert.equal(whole.ledger.balance,5);assert.equal(whole.ledger.paid,100);
});
test('Financial CSV reconciles original + delta = final without changing POS or actual receipts',()=>{
 const ledger=fixture(),row={businessDate:source.end,posIncome:150,actualIncome:147,cashAmount:47,creditCardAmount:100,otherAmount:0,difference:-3,staffNetPay:100,staffObligation:110,taxWithheld:10,shopShare:40,shopNetIncome:37};
 const projected=api.projectPayrollShopRows([row],ledger)[0],csv=api.payrollFinancialExport([projected])[0];
 assert.equal(projected.posIncome,150);assert.equal(projected.actualIncome,147);assert.equal(projected.staffObligation,115);assert.equal(projected.shopNetIncome,32);
 for(const [original,delta,final]of[[10,11,12],[13,14,15],[16,17,18],[19,20,21]])assert.equal(csv[original]+csv[delta],csv[final]);
 assert.equal(api.payrollFinancialExport([row])[0][10],null);
});
function authApi(ledger=fixture()){
 const calls=[],auth={salon:{id:'salon'},user:{id:'owner'},supabase:{rpc(name,args){calls.push({name,args});return{abortSignal:async()=>({data:ledger,error:null})};}}};
 return{calls,api:loadPayrollCalculation(process.cwd(),auth)};
}
test('Account/salon change rejects adjustment, payment and verification before any RPC',async()=>{
 const {api:guard,calls}=authApi();
 for(const name of['createOwnerPayrollAdjustment','recordOwnerPayrollPayment','verifyOwnerPayrollRequest'])await assert.rejects(guard[name]({expectedScope:'salon:other'}),/account changed/);
 assert.equal(calls.length,0);
});
test('Readback confirms the same actor, staff and normalized payload, not just an ID',async()=>{
 const ledger=fixture(),{api:guard}=authApi(ledger);
 const input={expectedScope:'salon:owner',baseId:'base',staffId:'staff',requestId:'adjust',kind:'adjust',start:source.start,end:source.end,expected:{values:ledger.adjustments[0].after_values,reason:'Fixture correction'}};
 assert.equal((await guard.verifyOwnerPayrollRequest(input)).found,true);
 assert.equal((await guard.verifyOwnerPayrollRequest({...input,expected:{...input.expected,reason:'Different'}})).found,false);
 ledger.adjustments[0].actor_id='different-owner';assert.equal((await guard.verifyOwnerPayrollRequest(input)).found,false);
 const payment={...input,kind:'payment',requestId:'paid',expected:{cash:40,check:60,paidAt:'2026-10-05T12:00:00.000Z',note:'Already paid fixture'}};
 assert.equal((await guard.verifyOwnerPayrollRequest(payment)).found,true);assert.equal((await guard.verifyOwnerPayrollRequest({...payment,expected:{...payment.expected,cash:41}})).found,false);
});
