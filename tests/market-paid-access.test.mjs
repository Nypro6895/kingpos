import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function load(file,modules={}){const exports={};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;new Function('require','exports',code)(name=>modules[name]??{},exports);return exports;}
const access=load('lib/market-access.ts');
test('paid projection ignores active trials and subscription identifiers and expires at paidUntil',()=>{
 const now=Date.parse('2026-11-03T00:00:00Z');
 for(const paid_until of[null,undefined,'invalid','2026-11-03T00:00:00Z'])assert.equal(access.marketPaidActive({paid_until,trial_ends_at:'2030-01-01',stripe_subscription:'sub_incomplete'},now),false);
 assert.equal(access.marketPaidActive({paid_until:'2026-11-04T00:00:00Z'},now),true);
});

test('all generic entitlement readers project persisted paid time separately from trial and billing management',async()=>{
 let row,rpcRow;const reads=[];
 const client={async rpc(name){reads.push(name);return{data:rpcRow}},from(table){reads.push(table);return{select(){return this},eq(){return this},async maybeSingle(){return{data:row}}}}};
 const modules={'server-only':{},'react':{cache:fn=>fn},'@/lib/market-access':access,'@/lib/market-plugins':{marketPluginContext:async()=>({salonId:'salon_a',client})},'@/lib/market-payments':{marketServiceClient:()=>client,marketPaymentSettings:async()=>({booking_deposit_test_enabled:false})},'@/lib/supabase/server':{createAuthenticatedSupabaseServerClient:async()=>client},'@/types/booking-deposit':{EMPTY_BOOKING_DEPOSIT:{}},'@/types/booksms':{EMPTY_BOOKSMS:{}},'@/types/vietnamese-plugin':{EMPTY_VIETNAMESE_PLUGIN:{}}};
 const readers=[['lib/booking-policy-subscription.ts','bookingPolicySubscription'],['lib/checkin-receipt-subscription.ts','checkinReceiptSubscription'],['lib/tax-company-subscription.ts','taxCompanySubscription'],['lib/booking-deposit.ts','bookingDepositState'],['lib/booksms.ts','bookSmsState'],['lib/vietnamese-plugin.ts','vietnamesePluginState']].map(([file,name])=>({name,read:load(file,modules)[name]}));
 for(const paid of[false,true]){
  const paidUntil=paid?new Date(Date.now()+86400000).toISOString():null;
  row={paid_until:paidUntil,trial_ends_at:new Date(Date.now()+86400000).toISOString(),stripe_subscription:'sub_incomplete',installed:true};rpcRow={...row,active:true,subscribed:true,has_subscription:true,paidUntil};
  for(const {name,read}of readers){const before=reads.length,state=await read('salon_a');assert.equal(state.paid,paid,name+' paid is independent');assert.equal(state.active,true,name+' trial remains usable');assert.equal(state.subscribed??state.has_subscription,true,name+' keeps billing management');assert.equal(reads.length-before,1,name+' needs no extra read');}
 }
});

test('all seven Market checkout guards require explicit paid facts while incomplete subscriptions remain manageable',()=>{
 const file='app/market/market-client.tsx',source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let expression;
 function visit(node){if(ts.isJsxAttribute(node)&&node.name.text==='hasActiveSubscription')expression=node.initializer.expression.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert.ok(expression);
 const guard=new Function('selected','checkWriter','booksms','taxCompany','bookingDeposit','bookingPolicy','checkinReceipt','vietnamese','return '+expression);
 for(const id of['print-check','booksms','tax-company','booking-deposit','booking-policy','checkin-receipt','vietnamese-language'])for(const paid of[false,true]){const state={active:true,subscribed:true,has_subscription:true,paid};assert.equal(guard({id},state,state,state,state,state,state,state),paid,id+' must not infer payment from active+subscribed');}
});
