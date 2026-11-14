import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({stdin:{contents:`export {ticketFinancialView} from './lib/pos-ticket-financial-view'; export {calculateTicketTotals} from './lib/pos-ticket-calculations'; export {buildTicketReceipt} from './lib/pos-ticket-receipt'; export {buildDailyReportOverview} from './lib/daily-report-overview-model'; export {completedCustomerCheckoutView} from './lib/customer-checkout-view'; export {localReceiptSnapshot} from './lib/pos-local-display';`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'});
const {ticketFinancialView:view,calculateTicketTotals:calculate,buildTicketReceipt:receipt,buildDailyReportOverview:overview,completedCustomerCheckoutView:completed,localReceiptSnapshot:localSnapshot}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const at='2026-11-13T18:00:00Z';
const sale=(method='cash')=>({id:'sale',amountCents:10000,last4:'4821',paymentMethod:method,status:'completed',actorName:'Kim',createdAt:at});
const ticket=(changes={})=>({id:'ticket',salon_id:'salon',customer_id:null,customer:null,ticket_number:'T00001',opened_at:at,created_at:at,closed_at:at,status:'closed',discount_type:'percentage',discount_value:10,tax_rate:0,tip_type:'fixed_amount',tip_value:9,ticket_items:[{id:'service',line_total:50,unit_price:50,quantity:1,is_removed:false,service:{name:'Full Set'},assigned_staff:{display_name:'Kim'}}],payments:[{amount:54,payment_method:'cash',created_at:at}],financial_sources:{giftSales:[sale()],giftRedeemedCents:0,rewardDiscount:0},...changes});

test('mixed receipt adds Gift once, keeps discount and tip on service work, consolidates payments',()=>{
 const t=ticket(),result=view(t);assert.equal(result.totals.subtotal,150);assert.equal(result.totals.discount_amount,5);assert.equal(result.totals.total,154);assert.equal(result.totals.paid,154);assert.equal(result.totals.remaining,0);assert.deepEqual(result.payments.map(p=>[p.method,p.amount]),[['Cash',154]]);
 assert.equal(t.ticket_items.length,1,'projection cannot mutate work rows');assert.equal(t.payments[0].amount,54);
});

test('Gift has no assigned seller or service staff even when Kim performed the service and recorded the sale',()=>{
 for(const actorName of ['Kim','Another operator','Operator','']){
  const t=ticket({financial_sources:{giftSales:[{...sale(),actorName}],giftRedeemedCents:0,rewardDiscount:0}});
  const r=receipt({customer:null,items:t.ticket_items,payments:t.payments,ticket:t,salon:{name:'Test salon',phone:null},totals:calculate({items:t.ticket_items,discountType:t.discount_type,discountValue:t.discount_value,tipType:t.tip_type,tipValue:t.tip_value})});
  assert.equal(r.items[0].assigned_staff,'Kim','performed service retains its staff');
  assert.equal(r.items[1].assigned_staff,'','recording operator is audit evidence, not an explicitly selected Gift seller');
  assert.equal(r.totals.grand_total,154);
  assert.equal(t.financial_sources.giftSales[0].actorName,actorName,'operator audit remains intact');
 }
});
test('Reward already included in ticket discount is disclosed once',()=>{
 const t=ticket({discount_type:'fixed_amount',discount_value:10,financial_sources:{giftSales:[sale()],giftRedeemedCents:0,rewardDiscount:5},payments:[{amount:49,payment_method:'cash',created_at:at}]});
 const result=view(t);assert.equal(result.ordinaryDiscount,5);assert.equal(result.reward,5);assert.equal(result.totals.total,149);assert.equal(result.totals.remaining,0);
});
test('Gift-only receipt has no service, tip, customer or wage allocation',()=>{
 const t=ticket({ticket_items:[],payments:[],tip_value:0}),result=view(t);assert.equal(result.giftOnly,true);assert.equal(result.totals.total,100);assert.equal(result.totals.tip_amount,0);assert.equal(result.totals.discount_amount,0);assert.equal(result.totals.remaining,0);
 const r=receipt({customer:null,items:[],payments:[],ticket:t,salon:{name:'Test salon',phone:null},totals:calculate({})});assert.equal(r.header.customer_name,'Walk-in');assert.equal(r.items[0].service_name,'Gift card · •••• 4821');assert.equal(r.totals.grand_total,100);assert.equal(r.payments[0].amount,100);
});
test('ledger-backed legacy Gift redemption relabels payment; never counts as discount or new sale',()=>{
 const t=ticket({discount_value:0,tip_value:10,payments:[{amount:60,payment_method:'other',created_at:at}],financial_sources:{giftSales:[],giftRedeemedCents:6000,rewardDiscount:0}}),result=view(t);
 assert.equal(result.totals.total,60);assert.equal(result.totals.discount_amount,0);assert.equal(result.totals.paid,60);assert.equal(result.totals.remaining,0);assert.deepEqual(result.payments.map(p=>[p.method,p.amount]),[['Gift card',60]]);
});
test('partial Gift payment preserves new-money remainder and already classified Gift rows',()=>{
 for(const payments of [[{amount:60,payment_method:'other',created_at:at}],[{amount:25,payment_method:'gift_card',created_at:at},{amount:35,payment_method:'cash',created_at:at}]]){
  const result=view(ticket({discount_value:0,tip_value:10,payments,financial_sources:{giftSales:[],giftRedeemedCents:2500,rewardDiscount:0}}));assert.equal(result.totals.paid,60);assert.equal(result.payments.reduce((sum,p)=>sum+p.amount,0),60);assert.equal(result.payments.find(p=>p.method==='Gift card').amount,25);
 }
});
test('Portable receipt uses same recorded sources without synthetic payment rows',()=>{
 const t=ticket({payments:undefined,financial_sources:{giftSales:[sale('credit_card')],giftRedeemedCents:0,rewardDiscount:0,recordedPayments:[{amount:54,paymentMethod:'credit_card',createdAt:at}]}}),result=view(t);
 assert.equal(result.totals.paid,154);assert.equal(result.payments.length,1);assert.equal(result.payments[0].method,'Card');assert.equal(result.totals.remaining,0);
});
test('voided sale retains original receipt amounts and reversal status',()=>{
 const t=ticket({status:'voided',financial_sources:{giftSales:[{...sale(),status:'voided'}],giftRedeemedCents:0,rewardDiscount:0}}),result=view(t);assert.equal(result.totals.total,154);assert.equal(result.giftSales[0].status,'voided');
});
test('daily report lists Gift on same ticket and keeps staff work unchanged',()=>{
 const t=ticket();t.ticket_items[0].service_name_snapshot='Full Set';t.ticket_items[0].assigned_staff_id='staff';t.ticket_items[0].assigned_staff={id:'staff',display_name:'Kim'};t.ticket_items[0].turn_parts=[];
 const result=overview({date:'2026-11-13',timeZone:'America/Chicago',tickets:[t],visits:[],workdays:[],report:{staffRows:[{staffId:'staff',staffName:'Kim',totalTurns:1,totalEarned:50}]}});
 assert.equal(result.visits.length,1);assert.equal(result.visits[0].amount,154);assert.equal(result.visits[0].lines.length,2);assert.equal(result.staff[0].posAmount,50);assert.equal(result.staff[0].turns,1);assert.equal(result.checkInCount,0);
 assert.equal(result.visits[0].lines[0].staff[0].name,'Kim');
 assert.deepEqual(result.visits[0].lines[1].staff,[],'Gift has no performed staff or inferred seller');
});
test('completed customer total accepts only the exact closed receipt revision',()=>{
 const draft={id:'draft',status:'closed',receipt_version:3,customer_version:2,total:54};
 const gift={status:'completed',completedDraftId:'draft',completedReceiptVersion:3,completedCustomerVersion:2,purchase:10000,amount:0};
 assert.equal(completed(draft,gift).total,15400);
 for(const next of [{...draft,status:'draft'},{...draft,id:'next'},{...draft,receipt_version:4},{...draft,customer_version:3}])assert.equal(completed(next,gift).total,5400);
 assert.equal(completed(draft,{status:'completed',purchase:10000}).total,5400,'older clients without identity cannot attach an old Gift');
 assert.equal(completed(null,{status:'completed',purchase:10000}).total,0);
});
test('local success snapshot keeps Gift under the submitted cart and clears it on the next draft',()=>{
 const payload={token:'token',staffLines:[],customer:null,total:54,totalBeforeTip:45,subtotal:50,discount:5,tax:0,tip:9};
 const first=localSnapshot(null,{cartId:'submitted',revision:'one',payload,completedAt:at,settledReceipt:{ticketNumber:'T00024',giftPurchaseCents:10000,giftPaidCents:0}});
 assert.equal(completed(first,null).total,15400);
 const next=localSnapshot(first,{cartId:'next',revision:'two',payload});assert.equal(next.settled_receipt,undefined);assert.equal(completed(next,null).total,5400);
 const invalid=localSnapshot(null,{cartId:'invalid',revision:'three',payload,completedAt:at,settledReceipt:{giftPurchaseCents:NaN,giftPaidCents:0}});assert.equal(invalid.settled_receipt,undefined);
});
