import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

test('Gift delivery recovery: authorized same-card read after expiry; no value, ownership or checkout mutation',{
  timeout:600000,skip:process.env.RUN_REWARD_SQL!=='1',
},async t=>{
  const f=await startIsolatedSupabase('gift-ticket-delivery',JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{}'),{allowConcurrentFixtureCleanup:true});
  t.after(()=>f.close());const owner=f.person('delivery-owner'),outsider=f.person('delivery-outsider'),buyer=f.person('delivery-buyer');
  const account=f.rpc(owner,'ensure_personal_account_for_current_user',{p_account_name:'Gift delivery QA'})[0].account_id;
  const salon=f.rpc(owner,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:id(),p_name:'Gift delivery QA',p_owner_is_staff:true,p_country:'US'}).salon_id;
  f.rpc(owner,'gift_card_owner',{p_salon:salon,p_op:'install',p_args:{installed:true}});
  const pos=(op,args)=>f.rpc(owner,'gift_card_pos',{p_salon:salon,p_op:op,p_args:args});
  const receipt={requestId:id(),lines:[],discountType:'fixed_amount',discountValue:0,tipAmount:0},token='owner:'+id();
  let s=pos('sync',{token,receipt}).session;s=pos('open',{sessionId:s.id,revision:s.revision,mode:'buy',entry:'code'}).session;
  assert.equal(s.dismissed,false);const bad=f.http(3000,'/rpc/gift_card_pos','POST',{p_salon:salon,p_op:'buy',p_args:{sessionId:s.id,revision:s.revision,amount:0}},owner.token);
  assert.ok(bad.status>=400);assert.equal(pos('read',{sessionId:s.id}).session.dismissed,false,'failed Buy does not close');
  s=pos('buy',{sessionId:s.id,revision:s.revision,amount:5000}).session;assert.equal(s.dismissed,true,'accepted Buy closes paired editor');assert.equal(s.purchase,5000);
  const submit={sessionId:s.id,revision:s.revision,paymentMethod:'cash'},sold=pos('submit',submit);assert.ok(sold.ticketId);
  const sale=sold.giftSaleId,card=sold.session.deliveryCard.id,args={p_salon:salon,p_ticket:sold.ticketId,p_sale:sale};
  const original=sold.session.delivery;
  f.sql(`update gift_card_sessions set expires_at=now()-interval '1 minute',completed_at=now()-interval '11 minutes' where id='${s.id}'`);
  assert.equal(pos('read',{sessionId:s.id}).session.delivery,undefined,'old session lifetime has actually expired');
  const nextReceipt={...receipt,requestId:id()};let next=pos('sync',{token,receipt:nextReceipt}).session;
  next=pos('open',{sessionId:next.id,revision:next.revision,mode:'use',entry:'code'}).session;assert.equal(next.mode,'use');assert.notEqual(next.id,s.id);
  const snapshot=()=>f.json(`select json_build_object('card',(select row_to_json(c) from gift_cards c where id='${card}'),'session',(select row_to_json(s) from gift_card_sessions s where id='${s.id}'),'next',(select row_to_json(s) from gift_card_sessions s where id='${next.id}'),'sales',(select count(*) from gift_card_counter_sales where salon_id='${salon}'),'ledger',(select count(*) from gift_card_ledger where salon_id='${salon}'))`);
  const before=snapshot();const ready=f.rpc(owner,'gift_card_ticket_delivery',args);
  assert.equal(ready.deliveryStatus,'ready');assert.equal(ready.token,original);assert.equal(ready.card.id,card);
  assert.equal(f.rpc(owner,'gift_card_ticket_delivery',args).token,original);assert.deepEqual(snapshot(),before);
  assert.equal(pos('submit',submit).giftSaleId,sale,'lost Submit response still replays the original sale');
  const key=id();f.sql(`insert into pos_portable_access_keys(id,salon_id,access_id,passcode_salt,passcode_digest,capabilities) values('${key}','${salon}','${id()}','fixture-salt','fixture-digest',array['portable.pos.use']);`);
  const signature=f.sql(`select pos_portable_access_signature('${key}','fixture-digest')`);
  assert.equal(f.rpc(null,'gift_card_ticket_delivery',{...args,p_key:key,p_signature:signature}).token,original);
  for(const [person,request] of [[null,args],[outsider,args],[null,{...args,p_key:key,p_signature:'wrong'}],[owner,{...args,p_ticket:id()}],[owner,{...args,p_sale:id()}],[owner,{...args,p_salon:id()}]]){
    const denied=f.http(3000,'/rpc/gift_card_ticket_delivery','POST',request,person?.token);assert.ok(denied.status>=400);assert.equal(denied.data?.token,undefined);
  }
  const restricted=id();f.sql(`insert into pos_portable_access_keys(id,salon_id,access_id,passcode_salt,passcode_digest,capabilities) values('${restricted}','${salon}','${id()}','fixture-salt','fixture-digest',array['portable.today.view']);`);
  const restrictedSignature=f.sql(`select pos_portable_access_signature('${restricted}','fixture-digest')`);
  assert.ok(f.http(3000,'/rpc/gift_card_ticket_delivery','POST',{...args,p_key:restricted,p_signature:restrictedSignature}).status>=400);
  const sources=f.rpc(owner,'ticket_financial_sources',{p_salon:salon,p_tickets:[sold.ticketId]});
  const checkKeys=value=>{if(!value||typeof value!=='object')return;for(const [key,child] of Object.entries(value)){assert.doesNotMatch(key,/token|delivery|pin|seed|credential/i,'generic financial source keys contain no credentials');checkKeys(child);}};checkKeys(sources);
  f.rpc(null,'gift_card_public',{p_token:original,p_op:'receive',p_args:{}});
  let state=f.rpc(owner,'gift_card_ticket_delivery',args);assert.equal(state.deliveryStatus,'collected');assert.equal(state.token,undefined);
  f.rpc(buyer,'gift_card_wallet',{p_op:'claim',p_args:{token:original}});
  state=f.rpc(owner,'gift_card_ticket_delivery',args);assert.equal(state.deliveryStatus,'collected');assert.equal(state.token,undefined);
  f.rpc(buyer,'gift_card_wallet',{p_op:'transfer',p_args:{cardId:card,requestId:id()}});
  state=f.rpc(owner,'gift_card_ticket_delivery',args);assert.equal(state.deliveryStatus,'transferred');assert.equal(state.token,undefined);
  f.sql(`update gift_card_counter_sales set status='voided' where id='${sale}';update gift_cards set status='refunded' where id='${card}'`);
  state=f.rpc(owner,'gift_card_ticket_delivery',args);assert.equal(state.deliveryStatus,'voided');assert.equal(state.token,undefined);
  const customer=id();f.sql(`insert into customers(id,location_id,name,customer_user_id) values('${customer}','${salon}','Known Gift buyer','${buyer.profileId}')`);
  let known=pos('sync',{token:'owner:'+id(),receipt:{...receipt,requestId:id(),customerId:customer}}).session;
  known=pos('buy',{sessionId:known.id,revision:known.revision,amount:2500}).session;
  const knownSold=pos('submit',{sessionId:known.id,revision:known.revision,paymentMethod:'cash'});
  assert.equal(knownSold.session.collected,true);assert.equal(knownSold.session.delivery,undefined);
  const knownDelivery=f.rpc(owner,'gift_card_ticket_delivery',{p_salon:salon,p_ticket:knownSold.ticketId,p_sale:knownSold.giftSaleId});
  assert.equal(knownDelivery.deliveryStatus,'collected');assert.equal(knownDelivery.token,undefined,'known-account sale is immediately wallet-only');
  f.save('gift-ticket-delivery-result.json',{passed:true,expiryRecovery:true,sameCard:true,unchangedValueOwnershipCheckout:true,replayOnce:true,portableScoped:true,unauthorizedDenied:true,noGenericSecrets:true,receivedClaimedTransferredVoidedProtected:true});
});
