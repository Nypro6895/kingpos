import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {runtime,status,sql,assertMarker,writeJson} from './common.mjs';
assertMarker();const settings=status(),a=JSON.parse(fs.readFileSync(path.join(runtime,'access.json')));
const clients={};
for(const person of a.people){const client=createClient(settings.API_URL,settings.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const login=await client.auth.signInWithPassword({email:person.email,password:person.password});if(login.error)throw login.error;clients[person.role]=client;}
const service=createClient(settings.API_URL,settings.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const owner=a.people.find(p=>p.role==='owner'),customer=a.people.find(p=>p.role==='customer');
const only=process.argv.find(arg=>arg.startsWith('--only='))?.slice(7);
const receiptPath=path.join(runtime,'smoke-results.json');
const results=only&&fs.existsSync(receiptPath)?JSON.parse(fs.readFileSync(receiptPath)).results:[];
async function rpc(client,name,args){const r=await client.rpc(name,args);if(r.error)throw Error(name+': '+r.error.message);return r.data;}
async function step(name,run){if(only&&!name.startsWith(only))return;const index=results.findIndex(r=>r.name===name);if(index>=0)results.splice(index,1);try{const evidence=await run();results.push({name,passed:true,checkedAt:new Date().toISOString(),evidence});console.log('PASS '+name);}catch(error){results.push({name,passed:false,checkedAt:new Date().toISOString(),error:error.message});console.log('FAIL '+name+': '+error.message);}}
await step('Local authorization boundary',async()=>{
 const denied=await clients.outsider.rpc('reward_owner',{p_salon:a.salon,p_op:'save',p_args:{}});assert.ok(denied.error);return {outsiderWriteDenied:true};
});
await step('Book and cancel a synthetic appointment',async()=>{
 const start=new Date();start.setUTCDate(start.getUTCDate()+2);start.setUTCHours(16,0,0,0);const end=new Date(start.getTime()+30*60000);
 const result=await rpc(clients.customer,'create_public_booking',{p_salon_id:a.salon,p_customer_first_name:'QA',p_customer_last_name:'Customer',p_customer_phone:'+12025550102',p_customer_email:customer.email,p_start_at:start.toISOString(),p_end_at:end.toISOString(),p_idempotency_key:crypto.randomUUID(),p_lines:[{assigned_staff_id:a.staffId,service_id:a.service,unit_price:50,scheduled_start_at:start.toISOString(),scheduled_end_at:end.toISOString(),cleanup_buffer_minutes:0,display_order:0,line_type:'service',parent_service_id:null}],p_public_notes:'LOCAL QA ONLY',p_source:'public_profile'});
 const bookingId=typeof result==='string'?result:result.booking_id||result.id;
 assert.ok(bookingId,'Booking ID missing');await rpc(clients.customer,'cancel_customer_booking',{p_booking_id:bookingId,p_reason:'Local QA smoke cancellation'});
 return {bookingId,cancelled:true};
});
await step('Forum post persisted under the synthetic owner',async()=>{
 const section=sql('select id from forum_sections where not archived order by position limit 1');
 const post=await rpc(clients.owner,'forum_write',{p_input:{op:'topic',section,title:'LOCAL QA — test discussion',body:'Synthetic QA post. No customer or production data.',state:'WI'}});
 assert.ok(post.id);return {postId:post.id};
});
await step('Gift counter payment recorded without charging a card',async()=>{
 let session=(await rpc(clients.owner,'gift_card_pos',{p_salon:a.salon,p_op:'sync',p_args:{token:'owner:'+crypto.randomUUID(),receipt:{requestId:crypto.randomUUID(),lines:[],discountType:'fixed_amount',discountValue:0,tipAmount:0}}})).session;
 session=(await rpc(clients.owner,'gift_card_pos',{p_salon:a.salon,p_op:'buy',p_args:{sessionId:session.id,revision:session.revision,amount:10000}})).session;
 const result=await rpc(clients.owner,'gift_card_pos',{p_salon:a.salon,p_op:'submit',p_args:{sessionId:session.id,revision:session.revision}});
 assert.ok(result.giftSaleId);assert.equal(result.amountDueCents,10000);assert.equal(result.paymentEvidence,'record_only');return {giftSaleId:result.giftSaleId,paymentEvidence:result.paymentEvidence};
});
await step('Reward request, customer consent and POS settlement',async()=>{
 sql(`update customer_visits set status='cancelled',cancelled_at=now(),cancelled_reason='Previous local QA smoke fixture closed before repeat' where salon_id='${a.salon}' and customer_id='${a.customerId}' and status in ('waiting','in_service','checkout') and origin_metadata->>'token' like 'qa-reward-%';`);
 sql(`insert into reward_ledger(salon_id,user_id,delta,reason,event_key) select '${a.salon}','${customer.profileId}',500,'Local QA smoke top-up','qa-smoke:${crypto.randomUUID()}' where (select coalesce(sum(delta),0) from reward_ledger where salon_id='${a.salon}' and user_id='${customer.profileId}')<100;`);
 const visit=crypto.randomUUID(),token='qa-reward-'+crypto.randomUUID();
 sql(`insert into customer_visits(id,salon_id,customer_id,origin_metadata) values('${visit}','${a.salon}','${a.customerId}','{"token":"${token}"}');insert into pos_live_drafts(salon_id,token,customer) values('${a.salon}','${token}','{"id":"${a.customerId}","name":"QA Customer"}');`);
 const receipt={customerId:a.customerId,customerVisitId:visit,discountType:'fixed_amount',discountValue:0,tipAmount:0,liveDraftToken:token,lines:[{id:crypto.randomUUID(),staffId:a.staffId,serviceId:a.service,serviceLabel:'QA Manicure',total:50,amountInput:'50',amountParts:[50]}]};
 await rpc(clients.customer,'reward_personal',{p_op:'request',p_args:{visitId:visit,offerId:'qa-five-off'}});
 const view=(await rpc(clients.owner,'reward_pos',{p_salon:a.salon,p_op:'quote',p_args:{receipt,token}})).view;
 const confirmed=await rpc(clients.customer,'reward_personal',{p_op:'confirm',p_args:{visitId:visit,revision:view.request.revision,quote:view.request.quote}});
 assert.equal(confirmed.view.request.status,'confirmed');receipt.rewardQuote=confirmed.view.request.quote;
 const paid=await rpc(clients.owner,'replay_pos_owner_operation',{p_salon:a.salon,p_operation_id:crypto.randomUUID(),p_occurred_at:new Date().toISOString(),p_payload:receipt});
 assert.ok(paid.ticketId);assert.equal(Number(sql(`select sum(amount) from pos_payments where ticket_id='${paid.ticketId}'`)),45);
 return {ticketId:paid.ticketId,servicePayment:45,realMoney:false};
});
await step('Campaign submitted and synthetic credits reserved',async()=>{
 const post=crypto.randomUUID(),campaign=crypto.randomUUID();
 sql(`select set_config('request.jwt.claim.sub','${owner.authId}',false);insert into salon_profile_looks(id,salon_id,author_user_id,created_by_user_id,title,caption,media_path,status,published_at) values('${post}','${a.salon}','${owner.profileId}','${owner.profileId}','LOCAL QA campaign post','Synthetic content only','qa/test.png','published',now());`);
 const version=Number(sql('select version from owner_campaign_settings where id=true'));
 const id=await rpc(service,'campaign_create_versioned',{p_expected:version,p_id:campaign,p_salon:a.salon,p_user:owner.profileId,p_type:'salon_profile_look',p_source:post,p_area:'city',p_location:'Milwaukee',p_country:'US',p_state:'WI',p_city:'Milwaukee',p_views:500,p_days:1,p_limit:100,p_keep:false,p_auto:false});
 const state=await rpc(service,'campaign_credit_fund',{p_id:id,p_salon:a.salon,p_owner:owner.profileId,p_keep:false});
 assert.equal(state,'pending_review');return {campaignId:id,status:state};
});
await step('Campaign review and local delivery admission',async()=>{
 const campaign=sql(`select id from owner_campaigns where salon_id='${a.salon}' and status='pending_review' order by created_at desc limit 1`);
 assert.ok(campaign,'No submitted QA campaign awaiting review');
 sql(`update owner_campaigns set location='Milwaukee' where id='${campaign}' and salon_id='${a.salon}' and area='city';`);
 const adminContext=await rpc(clients.reviewer,'get_current_platform_admin_context',{});
 assert.equal((Array.isArray(adminContext)?adminContext[0]:adminContext)?.role_slug,'platform_owner');
 await rpc(service,'owner_campaign_review',{p_id:campaign,p_approve:true});
 const admitted=await rpc(service,'owner_campaign_admit',{p_id:campaign,p_visitor:crypto.randomBytes(32).toString('hex'),p_kind:'view',p_area:{country:'US',state:'WI',city:'Milwaukee'},p_viewer:customer.profileId,p_nonce:crypto.randomUUID()});
 assert.equal(admitted,true);return {campaignId:campaign,reviewedByQaReviewer:true,localViewAdmitted:true};
});
writeJson('smoke-results.json',{at:new Date().toISOString(),syntheticOnly:true,results});
if(results.some(r=>!r.passed))process.exitCode=1;
