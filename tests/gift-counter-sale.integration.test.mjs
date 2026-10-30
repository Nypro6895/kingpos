import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

test('Gift future-value sale stays outside current service discount, tip and staff inputs', {timeout:900000,skip:process.env.RUN_REWARD_SQL!=='1'}, async t=>{
 const f=await startIsolatedSupabase('gift-counter-sale',JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{}'),{allowConcurrentFixtureCleanup:true});
 t.after(()=>f.close());
 const id=()=>crypto.randomUUID(),owner=f.person('sale-owner');
 const account=f.rpc(owner,'ensure_personal_account_for_current_user',{p_account_name:'Gift sale QA'})[0].account_id;
 const salon=f.rpc(owner,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:id(),p_name:'Gift sale QA',p_owner_is_staff:true,p_country:'US'}).salon_id;
 const staff=f.sql(`select id from staff where salon_id='${salon}' limit 1`), service=id();
 f.sql(`update pos_settings set staff_check_in_enabled=false where salon_id='${salon}';update staff set pos_enabled=true,is_active=true where id='${staff}';insert into services(id,salon_id,name,base_price) values('${service}','${salon}','Service',50);`);
 const pos=(op,args={})=>f.rpc(owner,'gift_card_pos',{p_salon:salon,p_op:op,p_args:args});
 f.rpc(owner,'gift_card_owner',{p_salon:salon,p_op:'install',p_args:{installed:true}});
 function purchase(receipt,amount){const token='owner:'+id();let s=pos('sync',{token,receipt}).session;s=pos('buy',{sessionId:s.id,revision:s.revision,amount}).session;return {sessionId:s.id,revision:s.revision};}
 let mixed,only;
 await t.test('service50, discount10%, tip9, Gift100: amount due154, canonical service payment54',()=>{
  const args=purchase({requestId:id(),discountType:'percentage',discountValue:10,tipAmount:9,lines:[{staffId:staff,serviceId:service,serviceLabel:'Service',total:50,amountInput:'50',amountParts:[50]}]},10000);
  mixed=pos('submit',args);assert.ok(mixed.ticketId);assert.ok(mixed.giftSaleId);assert.equal(mixed.amountDueCents,15400);assert.equal(mixed.paymentEvidence,'record_only');
  const ticket=f.json(`select json_build_object('discountType',discount_type,'discountValue',discount_value,'tip',tip_value) from pos_tickets where id='${mixed.ticketId}'`);
  assert.equal(ticket.discountType,'percentage');assert.equal(Number(ticket.discountValue),10);assert.equal(Number(ticket.tip),9);
  assert.equal(Number(f.sql(`select sum(amount) from pos_payments where ticket_id='${mixed.ticketId}'`)),54);
  assert.equal(Number(f.sql(`select sum(line_total) from pos_ticket_items where pos_ticket_id='${mixed.ticketId}'`)),50);
  assert.equal(Number(f.sql(`select count(*) from pos_ticket_item_turn_parts where ticket_id='${mixed.ticketId}'`)),1);
  assert.equal(Number(f.sql(`select amount_cents from gift_card_counter_sales where id='${mixed.giftSaleId}'`)),10000);
  assert.equal(pos('submit',args).giftSaleId,mixed.giftSaleId);
  assert.equal(Number(f.sql(`select count(*) from gift_card_counter_sales where session_id='${args.sessionId}'`)),1);
 });
 await t.test('Gift-only uses same Submit, has zero service tickets, tips, turns or Reward spend',()=>{
  const before=Number(f.sql(`select count(*) from pos_tickets where salon_id='${salon}'`));
  const args=purchase({requestId:id(),lines:[],discountType:'percentage',discountValue:100,tipAmount:20},10000), result=pos('submit',args);only=result;
  assert.ok(result.giftSaleId);assert.equal(result.ticketId,undefined);assert.equal(result.amountDueCents,10000);
  assert.equal(Number(f.sql(`select count(*) from pos_tickets where salon_id='${salon}'`)),before);
  assert.equal(Number(f.sql(`select sum(balance) from gift_cards where salon_id='${salon}'`)),20000);
  assert.equal(Number(f.sql(`select count(*) from reward_ledger where salon_id='${salon}' and reason='Paid visit'`)),0);
 });
 await t.test('Portable source report leaves service/tip reconciliation untouched',()=>{
  const key=id();f.sql(`insert into pos_portable_access_keys(id,salon_id,access_id,passcode_salt,passcode_digest,capabilities) values('${key}','${salon}','${id()}','fixture-salt','fixture-digest',array['portable.pos.use','portable.report.view'])`);
  const signature=f.sql(`select pos_portable_access_signature('${key}','fixture-digest')`),day=f.sql(`select get_salon_business_date('${salon}')`);
  const args={p_key_id:key,p_session_signature:signature,p_report_date:day};
  const expected=f.json(`select gift_card_report_before_gifts('${key}','${signature}','${day}')`), actual=f.rpc(null,'get_pos_portable_report_data',args);
  for(const field of ['expectedTotal','difference','actualTotal','reconciliationStatus'])assert.deepEqual(actual.totals[field],expected.totals[field],field);
  assert.equal(actual.totals.giftCardSales,200);assert.equal(actual.totals.giftCardRedeemed,0);
 });
 await t.test('counter sale storage and issuance inaccessible directly to customers',()=>{
  assert.ok(f.http(3000,'/gift_card_counter_sales?select=*','GET').status>=400);
  assert.ok(f.http(3000,'/rpc/gift_card_pos','POST',{p_salon:salon,p_op:'submit',p_args:{sessionId:id(),revision:0}}).status>=400);
 });
 await t.test('unused mixed sale void revokes future value once and retains source history',()=>{
  const revision=Number(f.sql(`select workspace_revision from pos_tickets where id='${mixed.ticketId}'`));
  const args={p_salon:salon,p_ticket:mixed.ticketId,p_expected:revision,p_request:id(),p_operation:'void',p_values:{},p_note:'Synthetic Gift sale void QA'};
  f.rpc(owner,'mutate_owner_ticket_inputs',args);
  assert.equal(f.sql(`select status from gift_card_counter_sales where id='${mixed.giftSaleId}'`),'voided');
  assert.equal(Number(f.sql(`select balance from gift_cards where id=(select card_id from gift_card_counter_sales where id='${mixed.giftSaleId}')`)),0);
  f.rpc(owner,'mutate_owner_ticket_inputs',args);
  assert.equal(Number(f.sql(`select count(*) from gift_card_ledger where reversal_of in(select id from gift_card_ledger where ticket_id='${mixed.ticketId}' and kind='issue')`)),1);
 });
 await t.test('disabling sales between selection and Submit rolls back service ticket and card issuance together',()=>{
  const args=purchase({requestId:id(),discountType:'fixed_amount',discountValue:0,tipAmount:0,lines:[{staffId:staff,serviceId:service,serviceLabel:'Service',total:50,amountInput:'50',amountParts:[50]}]},10000);
  const before=f.json(`select json_build_object('tickets',(select count(*) from pos_tickets where salon_id='${salon}'),'cards',(select count(*) from gift_cards where salon_id='${salon}'))`);
  f.rpc(owner,'gift_card_owner',{p_salon:salon,p_op:'install',p_args:{installed:false}});
  assert.ok(f.http(3000,'/rpc/gift_card_pos','POST',{p_salon:salon,p_op:'submit',p_args:args},owner.token).status>=400);
  const after=f.json(`select json_build_object('tickets',(select count(*) from pos_tickets where salon_id='${salon}'),'cards',(select count(*) from gift_cards where salon_id='${salon}'))`);assert.deepEqual(after,before);
  f.rpc(owner,'gift_card_owner',{p_salon:salon,p_op:'install',p_args:{installed:true}});
 });
 await t.test('standalone unused sale owner void is idempotent, source scoped and not an external refund claim',()=>{
  const args={p_salon:salon,p_sale:only.giftSaleId};
  assert.ok(f.http(3000,'/rpc/gift_card_void_counter_sale','POST',args).status>=400);
  assert.equal(f.rpc(owner,'gift_card_void_counter_sale',args).status,'voided');
  assert.equal(f.rpc(owner,'gift_card_void_counter_sale',args).status,'voided');
  const view=f.rpc(owner,'gift_card_owner',{p_salon:salon,p_op:'read',p_args:{}});
  assert.equal(view.counterSales.length,2);assert.ok(view.counterSales.every(sale=>sale.status==='voided'));
 });
 await t.test('Gift funding services50 and tip10 reduces service reconciliation by50 only, preserving authoritative staff and tip inputs',()=>{
  const card=f.sql(`select gift_card_issue('${salon}',10000,null,'${id()}',null)`),credentials=f.json(`select gift_card_credentials('${card}')`);
  const receipt={requestId:id(),discountType:'fixed_amount',discountValue:0,tipAmount:10,lines:[{staffId:staff,serviceId:service,serviceLabel:'Service',total:50,amountInput:'50',amountParts:[50]}]};
  let session=pos('sync',{token:'owner:'+id(),receipt}).session;
  session=pos('code',{sessionId:session.id,revision:session.revision,code:credentials.code,pin:credentials.pin}).session;
  assert.equal(session.amount,6000);pos('submit',{sessionId:session.id,revision:session.revision});
  const day=f.sql(`select get_salon_business_date('${salon}')`),base=f.json(`select daily_input_reconciliation_before_gift_sources('${salon}','${day}')`),current=f.rpc(owner,'get_daily_input_reconciliation',{p_salon:salon,p_date:day});
  assert.equal(Number(current.expectedService),Number(base.expectedService)-50);assert.equal(Number(current.giftServiceDiscount),50);
  for(const field of ['grossService','discount','expectedTip','staffInputs','closingInputs'])assert.deepEqual(current[field],base[field],field+' remains canonical');
  const flow=f.rpc(owner,'gift_card_day_cashflow',{p_salon:salon,p_date:day});assert.equal(flow.serviceRedeemed,5000);assert.equal(flow.tipRedeemed,1000);assert.equal(flow.counterSales,0);
  assert.equal(Number(f.sql(`select sum(amount) from pos_payments where ticket_id=(select ticket_id from gift_card_ledger where card_id='${card}' and kind='redeem')`)),60);
 });
 f.save('gift-counter-sale-result.json',{passed:true,source:'gift_card_sale',mixedAmountDueCents:15400,canonicalServicePaymentCents:5400,giftPurchaseCents:10000,giftOnlyServiceTickets:0,portableReconciliationPreserved:true,externalPaymentClaim:false});
});
