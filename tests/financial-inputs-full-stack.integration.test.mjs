import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

test('approved financial inputs: full schema, authenticated RPC, RLS and separate service/tip reconciliation',{
 skip:process.env.RUN_ISOLATED_SUPABASE!=='1',timeout:900000,
},async t=>{
 const f=await startIsolatedSupabase('financial-inputs',JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{}'));t.after(()=>f.close());
 const owner=f.person('inputs-owner'),anna=f.person('inputs-anna'),lily=f.person('inputs-lily'),outsider=f.person('inputs-outsider'),manager=f.person('inputs-manager');
 const account=f.rpc(owner,'ensure_personal_account_for_current_user',{p_account_name:'Financial input fixture'})[0].account_id;
 const salon=f.rpc(owner,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:randomUUID(),p_name:'Financial input fixture',p_owner_is_staff:false,
 p_phone:null,p_address_line1:null,p_address_line2:null,p_city:null,p_state:null,p_postal_code:null,p_country:'US'}).salon_id;
 const staffA=randomUUID(),staffB=randomUUID();
 f.sql(`insert into staff(id,salon_id,account_user_id,display_name) values('${staffA}','${salon}','${anna.profileId}','Anna'),('${staffB}','${salon}','${lily.profileId}','Lily');`);
 f.sql(`insert into account_memberships(account_id,user_id,role_id,status) select '${account}','${manager.profileId}',id,'active' from roles where account_id='${account}' and code='MANAGER';`);
 assert.equal(Number(f.sql(`select count(*) from account_memberships where account_id='${account}' and user_id='${manager.profileId}'`)),1);
 f.sql(`insert into account_memberships(account_id,user_id,role_id,status) select '${account}',u.id,r.id,'active' from roles r cross join users u where r.account_id='${account}' and r.code='STAFF' and u.id in ('${anna.profileId}','${lily.profileId}');insert into role_permissions(role_id,permission_id) select r.id,p.id from roles r cross join permissions p where r.account_id='${account}' and r.code='STAFF' and p.code in ('tickets.view','reports.view','payroll.view','payroll.manage') on conflict(role_id,permission_id) do nothing;`);
 assert.equal(Number(f.sql(`select count(*) from account_memberships where account_id='${account}' and user_id in ('${anna.profileId}','${lily.profileId}')`)),2);
 const today=f.sql(`select get_salon_business_date('${salon}')`),yesterday=f.sql(`select get_salon_business_date('${salon}')-1`);
 const save=(who,staff,date,request,revision,beforeService,beforeTip,service,tip,note)=>f.rpc(who,'save_staff_day_financial_input',{p_salon:salon,p_staff:staff,p_date:date,p_request:request,p_revision:revision,p_expected_service:beforeService,p_expected_tip:beforeTip,p_service:service,p_tip:tip,p_note:note});
 await t.test('Owner edits original gross/tip, no-op/retry is not another amount and stale requests reject',()=>{
  const request=randomUUID();save(owner,staffA,today,request,0,0,0,40,5,'Recorded daily inputs');
  const before=Number(f.sql(`select count(*) from financial_input_events where salon_id='${salon}'`));
  save(owner,staffA,today,request,0,0,0,40,5,'Recorded daily inputs');
  assert.equal(Number(f.sql(`select count(*) from financial_input_events where salon_id='${salon}'`)),before);
  const state=f.rpc(owner,'read_staff_day_financial_input',{p_salon:salon,p_staff:staffA,p_date:today});
  save(owner,staffA,today,randomUUID(),state.revision,40,5,40,5,'Same inputs');
  assert.equal(Number(f.sql(`select count(*) from financial_input_events where salon_id='${salon}'`)),before);
  assert.ok(f.http(3000,'/rpc/save_staff_day_financial_input','POST',{p_salon:salon,p_staff:staffA,p_date:today,p_request:randomUUID(),p_revision:0,p_expected_service:0,p_expected_tip:0,p_service:99,p_tip:5,p_note:'Stale inputs'},owner.token).status>=400);
  save(owner,staffB,today,randomUUID(),0,0,0,60,15,'Recorded daily inputs');
 });
 await t.test('Staff reads own projected inputs/events only; outsider cannot mutate or read salon history',()=>{
  const own=f.rpc(anna,'effective_staff_day_inputs',{p_salon:salon,p_date:today});assert.equal(own.length,1);assert.equal(own[0].staff_id,staffA);
  assert.deepEqual(f.rest(anna,`/financial_input_events?salon_id=eq.${salon}`),[]);
  const history=f.rest(anna,`/financial_input_event_staff?salon_id=eq.${salon}`);assert.ok(history.length);assert.ok(history.every(row=>row.staff_id===staffA));
  assert.deepEqual(f.rest(outsider,`/financial_input_event_staff?salon_id=eq.${salon}`),[]);
  assert.ok(f.http(3000,'/rpc/save_staff_day_financial_input','POST',{p_salon:salon,p_staff:staffA,p_date:today,p_request:randomUUID(),p_revision:1,p_expected_service:40,p_expected_tip:5,p_service:45,p_tip:5,p_note:'Not Owner'},anna.token).status>=400);
 });
 await t.test('Cash/Card/Other exclude tip; two balances are independent and Daily Report never notifies Staff',()=>{
  const state=f.rpc(owner,'read_owner_live_daily_report',{p_salon:salon,p_date:today});
  const before=Number(f.sql(`select count(*) from app_notifications where salon_id='${salon}'`));
  f.rpc(owner,'save_owner_live_daily_report',{p_salon:salon,p_date:today,p_request:randomUUID(),p_expected_revision:state.current.revision,p_values:{cashAmount:100,creditCardAmount:0,otherAmount:0,tipInput:20,note:'Service and tips counted separately'}});
  const result=f.rpc(owner,'get_daily_input_reconciliation',{p_salon:salon,p_date:today});
  assert.equal(Number(result.expectedService),100);assert.equal(Number(result.expectedTip),20);
  assert.equal(Number(result.serviceDifference),0);assert.equal(Number(result.tipDifference),0);
  assert.equal(Number(f.sql(`select count(*) from app_notifications where salon_id='${salon}'`)),before);
 });
 await t.test('Owner can correct a past day without changing payments; after-day reconciliation has stable revisions',()=>{
  save(owner,staffA,yesterday,randomUUID(),0,0,0,100,20,'Past original inputs');
  const state=f.rpc(owner,'read_owner_live_daily_report',{p_salon:salon,p_date:yesterday});
  f.rpc(owner,'save_owner_live_daily_report',{p_salon:salon,p_date:yesterday,p_request:randomUUID(),p_expected_revision:state.current.revision,p_values:{cashAmount:90,creditCardAmount:0,otherAmount:0,tipInput:30,note:'Two independent variances'}});
  const result=f.rpc(owner,'get_daily_input_reconciliation',{p_salon:salon,p_date:yesterday});
  assert.equal(Number(result.serviceDifference),-10);assert.equal(Number(result.tipDifference),10);
  assert.equal(Number(f.sql(`select count(*) from payroll_recorded_payments where salon_id='${salon}'`)),0);
  const original=f.json(`select row_to_json(c) from daily_reconciliation_cases c where salon_id='${salon}' and business_date='${yesterday}'`);
  f.sql('select reconcile_closed_business_days(200)');
  const replay=f.json(`select row_to_json(c) from daily_reconciliation_cases c where salon_id='${salon}' and business_date='${yesterday}'`);
  assert.equal(replay.id,original.id);assert.equal(replay.revision,original.revision);
  const next=f.rpc(owner,'read_owner_live_daily_report',{p_salon:salon,p_date:yesterday});
  f.rpc(owner,'save_owner_live_daily_report',{p_salon:salon,p_date:yesterday,p_request:randomUUID(),p_expected_revision:next.current.revision,p_values:{cashAmount:100,creditCardAmount:0,otherAmount:0,tipInput:20,note:'Service and tip both reconciled'}});
  const resolved=f.json(`select row_to_json(c) from daily_reconciliation_cases c where salon_id='${salon}' and business_date='${yesterday}'`);
  assert.equal(resolved.id,original.id);assert.equal(resolved.status,'resolved');assert.equal(resolved.revision,original.revision+1);
  assert.deepEqual(f.rest(anna,`/daily_reconciliation_cases?salon_id=eq.${salon}`),[]);
 });
 await t.test('actual Owner receipt posts raw service/tip once, customer discount stays salon-only, and source edits preserve earning identities',()=>{
  const serviceA=randomUUID(),serviceB=randomUUID();
  f.sql(`update pos_settings set staff_check_in_enabled=false where salon_id='${salon}';insert into services(id,salon_id,name,base_price) values('${serviceA}','${salon}','Full set',40),('${serviceB}','${salon}','Pedicure',60);insert into staff_service_assignments(salon_id,staff_id,service_id) values('${salon}','${staffA}','${serviceA}'),('${salon}','${staffB}','${serviceB}');`);
  const receipt={lines:[{staffId:staffA,serviceId:serviceA,serviceLabel:'Full set',total:40,amountInput:'40',amountParts:[40]},{staffId:staffB,serviceId:serviceB,serviceLabel:'Pedicure',total:60,amountInput:'60',amountParts:[60]}],discountType:'fixed_amount',discountValue:10,tipAmount:20,customerName:'Isolated customer',note:'Input creation integration'};
  const request=randomUUID(),args={p_salon:salon,p_receipt:receipt,p_request:request};
  const result=f.rpc(owner,'submit_owner_ticket_inputs',args),ticket=result.ticketId;assert.ok(ticket);
  f.rpc(owner,'submit_owner_ticket_inputs',args);
  const earning=f.json(`select json_agg(e order by e.staff_id) from (select id,staff_id,service_total,tip_amount from pos_ticket_staff_earnings where ticket_id='${ticket}')e`);
  assert.equal(earning.reduce((n,e)=>n+Number(e.service_total),0),100);assert.equal(earning.reduce((n,e)=>n+Number(e.tip_amount),0),20);
  assert.equal(Number(f.sql(`select count(*) from financial_input_events where source_id='${ticket}'`)),1);
  const creation=f.json(`select row_to_json(e) from financial_input_events e where source_id='${ticket}'`);
  assert.equal(creation.event_action,'created');
  const creationNotices=f.json(`select json_agg(n) from app_notifications n where salon_id='${salon}' and event_key like '%${creation.id}%'`);
  assert.equal(creationNotices.length,3);assert.ok(creationNotices.every(n=>n.notification_type==='ticket_recorded'&&!/changed|updated/i.test(n.title)&&n.href.includes('inputEvent='+creation.id)&&n.href.endsWith('#ticket-record')));
  const ownCreation=f.rpc(anna,'get_financial_input_event_metadata',{p_event_ids:[creation.id]});
  assert.equal(ownCreation.length,1);assert.equal(ownCreation[0].event_action,'created');assert.equal(ownCreation[0].ticket_id,ticket);assert.equal(Number(ownCreation[0].after_context.service_total),40);assert.equal(ownCreation[0].after_context.lines.length,1);assert.equal(ownCreation[0].after_context.lines[0].service_name,'Full set');
  assert.ok(!JSON.stringify(ownCreation).includes('Pedicure'));assert.deepEqual(f.rpc(outsider,'get_financial_input_event_metadata',{p_event_ids:[creation.id]}),[]);
  const item=f.json(`select row_to_json(i) from pos_ticket_items i where pos_ticket_id='${ticket}' and assigned_staff_id='${staffA}'`);
  const revision=Number(f.sql(`select workspace_revision from pos_tickets where id='${ticket}'`));
  const edit={p_key:null,p_signature:null,p_salon:salon,p_ticket:ticket,p_expected:revision,p_item_updates:[{item_id:item.id,service_id:serviceA,staff_id:staffA,parts:[{amount:50}],remove:false}],p_item_parts:[],p_added_items:[],p_staff_tip_overrides:[],p_tip_total:20,p_reason:'Verified original inputs',p_discount_type:'fixed_amount',p_discount_value:15,p_request:randomUUID()};
  f.rpc(owner,'save_pos_ticket_inputs',edit);f.rpc(owner,'save_pos_ticket_inputs',edit);
  const after=f.json(`select json_agg(e order by e.staff_id) from (select id,staff_id,service_total,tip_amount from pos_ticket_staff_earnings where ticket_id='${ticket}')e`);
  assert.deepEqual(after.map(e=>e.id),earning.map(e=>e.id));assert.equal(after.reduce((n,e)=>n+Number(e.service_total),0),110);assert.equal(after.reduce((n,e)=>n+Number(e.tip_amount),0),20);
  assert.equal(Number(f.sql(`select count(*) from financial_input_events where source_id='${ticket}'`)),2);
  const changed=f.json(`select row_to_json(e) from financial_input_events e where source_id='${ticket}' and event_action='updated'`);
  const changedNotices=f.json(`select json_agg(n) from app_notifications n where salon_id='${salon}' and event_key like '%${changed.id}%'`);
  assert.equal(changedNotices.length,3);assert.ok(changedNotices.every(n=>n.notification_type==='financial_input_updated'&&n.href.includes('inputEvent='+changed.id)));
  assert.match(changedNotices.find(n=>n.recipient_user_id===anna.profileId).body,/\$40\.00 → \$50\.00/);
  assert.ok(!changedNotices.find(n=>n.recipient_user_id===anna.profileId).body.includes('$15.00'));
  assert.match(changedNotices.find(n=>n.recipient_user_id===lily.profileId).body,/Ticket discount changed/);
  const ownChanged=f.rpc(anna,'get_financial_input_event_metadata',{p_event_ids:[changed.id]});assert.equal(ownChanged[0].event_action,'updated');assert.equal(ownChanged[0].ticket_id,ticket);assert.equal(Number(ownChanged[0].before_context.service_total),40);assert.equal(Number(ownChanged[0].after_context.service_total),50);
  assert.equal(f.rpc(owner,'get_financial_input_event_metadata',{p_event_ids:[changed.id]})[0].ticket_id,ticket);
  assert.deepEqual(f.rpc(outsider,'get_financial_input_event_metadata',{p_event_ids:[changed.id]}),[]);
  assert.ok(f.http(3000,'/rpc/get_financial_input_event_metadata','POST',{p_event_ids:[changed.id]}).status>=400);
  // The actual signed Portable reader must return the exact linked saved facts,
  // including fields absent from the earlier raw correction snapshot.
  const key=randomUUID();f.sql(`insert into pos_portable_access_keys(id,salon_id,access_id,passcode_salt,passcode_digest,capabilities) values('${key}','${salon}','${randomUUID()}','isolated-salt','isolated-digest',array['portable.pos.use','portable.today.view','portable.report.view'])`);
  const signature=f.sql(`select pos_portable_access_signature('${key}','isolated-digest')`);
  const signed=f.rpc(null,'get_pos_portable_ticket_data',{p_key_id:key,p_session_signature:signature,p_date:today});
  const signedTicket=signed.tickets.find(row=>row.id===ticket);assert.ok(signedTicket);
  const signedEdit=signedTicket.adjustments.find(row=>row.financialInputEventId===changed.id);assert.ok(signedEdit);assert.equal(signedEdit.eventAction,'updated');
  assert.deepEqual(signedEdit.financialInputBeforeValues,changed.before_values);assert.deepEqual(signedEdit.financialInputAfterValues,changed.after_values);
  assert.equal(f.rpc(null,'get_pos_portable_ticket_data',{p_key_id:key,p_session_signature:'invalid',p_date:today}),null);
  const reportEvents=f.rpc(null,'get_pos_portable_daily_input_history',{p_key_id:key,p_session_signature:signature,p_report_date:today});assert.ok(reportEvents.length);
  assert.ok(reportEvents.every(row=>row.salon_id===salon&&row.business_date===today&&Object.keys(row.after_values).every(field=>['cash_amount','credit_card_amount','other_amount','tip_input','entered','note'].includes(field))));
  assert.ok(f.http(3000,'/rpc/get_pos_portable_daily_input_history','POST',{p_key_id:key,p_session_signature:signature,p_report_date:yesterday}).status>=400);
  assert.ok(f.http(3000,'/rpc/get_pos_portable_daily_input_history','POST',{p_key_id:key,p_session_signature:'invalid',p_report_date:today}).status>=400);
  assert.ok(f.http(3000,'/rpc/save_pos_ticket_inputs','POST',{...edit,p_request:randomUUID()},anna.token).status>=400);
  assert.ok(f.http(3000,'/rpc/save_pos_ticket_inputs','POST',{...edit,p_request:randomUUID()},manager.token).status>=400);
  for(const user of [owner,manager]) assert.equal(f.http(3000,`/pos_ticket_items?id=eq.${item.id}`,'PATCH',{unit_price:999},user.token).status,403);

  // Published actual cash/check evidence survives a historical source correction.
  // This fixture creates an immutable base directly, then records its payment
  // through the real authenticated payment RPC.
  const input=randomUUID(),base=randomUUID();
  f.sql(`insert into payroll_close_inputs(id,salon_id,period_start,period_end,cycle_type,timezone_iana,closed_at,input_packet,input_sha256) values('${input}','${salon}','${yesterday}','${today}','monthly','America/Chicago',clock_timestamp(),'{}','isolated-fixture');insert into payroll_period_bases(id,input_id,salon_id,period_start,period_end,cycle_type,original_snapshot,engine_version) values('${base}','${input}','${salon}','${yesterday}','${today}','monthly','{}','isolated-fixture');insert into payroll_base_staff_lines(base_id,salon_id,staff_id,original_line) values('${base}','${salon}','${staffA}','{"final_cash_amount":20,"final_check_amount":30}');`);
  f.rpc(owner,'record_payroll_payment',{p_base:base,p_staff:staffA,p_expected_revision:0,p_request:randomUUID(),p_cash:20,p_check:30,p_paid_at:new Date(Date.now()-10000).toISOString(),p_note:'Actual fixture payment'});
  const payments=f.json(`select json_agg(p order by p.id) from payroll_live_recorded_payments p where salon_id='${salon}'`);assert.equal(payments.length,1);assert.equal(Number(payments[0].cash_amount)+Number(payments[0].check_amount),50);
  f.sql(`update pos_tickets set opened_at=('${yesterday}'::date+time '12:00') at time zone get_salon_business_timezone('${salon}'),closed_at=('${yesterday}'::date+time '13:00') at time zone get_salon_business_timezone('${salon}') where id='${ticket}';update pos_ticket_staff_earnings set work_date='${yesterday}',locked_at=clock_timestamp(),payroll_batch_id='${base}' where ticket_id='${ticket}';`);
  const locked=f.json(`select json_agg(e order by e.id) from (select id,locked_at,payroll_batch_id from pos_ticket_staff_earnings where ticket_id='${ticket}')e`);
  f.rpc(owner,'save_pos_ticket_inputs',{...edit,p_expected:Number(f.sql(`select workspace_revision from pos_tickets where id='${ticket}'`)),p_request:randomUUID(),p_item_updates:[{...edit.p_item_updates[0],parts:[{amount:55}]}],p_reason:'Past paid source correction'});
  assert.deepEqual(f.json(`select json_agg(e order by e.id) from (select id,locked_at,payroll_batch_id from pos_ticket_staff_earnings where ticket_id='${ticket}')e`),locked);
  assert.deepEqual(f.json(`select json_agg(p order by p.id) from payroll_live_recorded_payments p where salon_id='${salon}'`),payments);
 });
 await t.test('actual live payments need no frozen base; supplements retain original period and replay cannot pay twice',()=>{
  const staffC=randomUUID();f.sql(`insert into staff(id,salon_id,display_name) values('${staffC}','${salon}','Cora')`);
  const month=f.json(`select json_build_object('start',(date_trunc('month','${today}'::date)-interval '1 month')::date,'end',(date_trunc('month','${today}'::date)-interval '1 day')::date)`);
  f.sql(`update salon_payroll_settings set cycle_type='monthly' where salon_id='${salon}'`);
  save(owner,staffB,month.end,randomUUID(),0,0,0,100,20,'Original prior-period gross and tip inputs');
  const baseCount=Number(f.sql(`select count(*) from payroll_period_bases where salon_id='${salon}' and period_start='${month.start}' and period_end='${month.end}'`));assert.equal(baseCount,0);
  const args={p_salon:salon,p_staff:staffB,p_start:month.start,p_end:month.end,p_request:randomUUID(),p_expected_revision:0,p_cash:10,p_check:20,p_paid_at:new Date(Date.now()-10000).toISOString(),p_note:'Actual payment without frozen payroll'};
  f.rpc(owner,'record_live_payroll_payment',args);f.rpc(owner,'record_live_payroll_payment',args);
  assert.ok(f.http(3000,'/rpc/record_live_payroll_payment','POST',{...args,p_cash:11},owner.token).status>=400);
  f.rpc(owner,'record_live_payroll_payment',{...args,p_request:randomUUID(),p_expected_revision:1,p_cash:5,p_check:0,p_paid_at:new Date(Date.now()-9000).toISOString(),p_note:'Supplement for the same original period'});
  f.rpc(owner,'record_live_payroll_payment',{...args,p_staff:staffC,p_request:randomUUID(),p_expected_revision:2,p_cash:5,p_check:5,p_note:'Other Staff payment'});
  const facts=f.rpc(lily,'read_live_payroll_recorded_facts',{p_salon:salon,p_start:month.start,p_end:month.end});
  assert.equal(facts.selection.exact,true);assert.ok(facts.periods.every(period=>(period.payments??[]).every(row=>row.staff_id===staffB)));
  const own=facts.periods.find(period=>period.sourcePeriod.start===month.start&&period.sourcePeriod.end===month.end);assert.equal(own.payments.length,2);assert.equal(own.payments.reduce((total,row)=>total+Number(row.cash_amount)+Number(row.check_amount),0),35);assert.ok(own.payments.every(row=>row.period_start===month.start&&row.period_end===month.end&&row.paid_at.slice(0,10)>month.end));
  assert.equal(Number(f.sql(`select count(*) from payroll_period_bases where salon_id='${salon}' and period_start='${month.start}' and period_end='${month.end}'`)),baseCount);
  assert.ok(f.rest(anna,`/payroll_live_recorded_payments?salon_id=eq.${salon}`).every(row=>row.staff_id===staffA));
  assert.ok(f.http(3000,'/rpc/record_live_payroll_payment','POST',{...args,p_request:randomUUID(),p_expected_revision:3},anna.token).status>=400);
 });
 await t.test('initial open-ticket construction stays draft, first checkout records once, and reopened corrections remain updates',()=>{
  const service=randomUUID();f.sql(`insert into services(id,salon_id,name,base_price) values('${service}','${salon}','Draft lifecycle service',30)`);
  const ticket=f.rpc(owner,'create_owner_open_ticket',{p_salon:salon,p_customer:null,p_opened_at:null,p_notes:'Initial construction',p_request:randomUUID()}).ticketId;
  const edit=(operation,values,note)=>f.rpc(owner,'mutate_owner_ticket_inputs',{p_salon:salon,p_ticket:ticket,p_expected:Number(f.sql(`select workspace_revision from pos_tickets where id='${ticket}'`)),p_request:randomUUID(),p_operation:operation,p_values:values,p_note:note});
  edit('item_add',{service_id:service},'Choose service');
  const item=f.sql(`select id from pos_ticket_items where pos_ticket_id='${ticket}'`);
  edit('item_staff',{item_id:item,assigned_staff_id:staffA},'Choose Staff');edit('tip',{tip_type:'fixed_amount',tip_value:5},'Enter original tip');edit('payment_add',{payment_method:'cash',amount:35},'Enter original payment');
  const drafts=f.json(`select json_agg(e order by e.created_at) from financial_input_events e where source_id='${ticket}'`);assert.equal(drafts.length,5);assert.ok(drafts.every(e=>e.event_action==='draft'));
  const draftAdjustments=f.json(`select json_agg(a) from pos_ticket_adjustments a where ticket_id='${ticket}'`);assert.equal(draftAdjustments.length,4);assert.ok(draftAdjustments.every(a=>drafts.some(e=>e.id===a.financial_input_event_id)));
  const draftMetadata=f.rpc(owner,'get_pos_ticket_adjustment_metadata',{p_adjustment_ids:draftAdjustments.map(a=>a.id)});assert.equal(draftMetadata.length,4);assert.ok(draftMetadata.every(a=>a.event_action==='draft'));
  assert.deepEqual(f.rpc(anna,'get_pos_ticket_adjustment_metadata',{p_adjustment_ids:draftAdjustments.map(a=>a.id)}),[]);assert.deepEqual(f.rpc(outsider,'get_pos_ticket_adjustment_metadata',{p_adjustment_ids:draftAdjustments.map(a=>a.id)}),[]);
  assert.equal(Number(f.sql(`select count(*) from app_notifications where event_key like any(array[${drafts.map(e=>`'%${e.id}%'`).join(',')}])`)),0);
  const submitted=edit('checkout',{},'First submission');
  const first=f.json(`select row_to_json(e) from financial_input_events e where id='${submitted.eventId}'`);assert.equal(first.event_action,'created');assert.equal(first.before_values.status,'open');assert.equal(first.after_values.status,'closed');
  const firstAdjustment=f.sql(`select id from pos_ticket_adjustments where financial_input_event_id='${first.id}'`);assert.ok(firstAdjustment);assert.equal(f.rpc(owner,'get_pos_ticket_adjustment_metadata',{p_adjustment_ids:[firstAdjustment]})[0].event_action,'created');
  const delivery=f.json(`select json_agg(n) from app_notifications n where event_key like '%${first.id}%'`);assert.equal(delivery.length,2);assert.ok(delivery.every(n=>n.notification_type==='ticket_recorded'&&!/updated|changed/i.test(n.title)));
  const own=f.rpc(anna,'get_financial_input_event_metadata',{p_event_ids:[...drafts.map(e=>e.id),first.id]});assert.equal(own.filter(e=>e.event_action==='created').length,1);assert.ok(own.filter(e=>e.event_id!==first.id).every(e=>e.event_action==='draft'));
  const reopened=edit('reopen',{},'Reopen submitted ticket');assert.equal(f.sql(`select event_action from financial_input_events where id='${reopened.eventId}'`),'updated');
  const changed=edit('item_update',{item_id:item,quantity:1,unit_price:35},'Correct previously submitted service');assert.equal(f.sql(`select event_action from financial_input_events where id='${changed.eventId}'`),'updated');
  const changedAdjustment=f.sql(`select id from pos_ticket_adjustments where financial_input_event_id='${changed.eventId}'`);assert.equal(f.rpc(owner,'get_pos_ticket_adjustment_metadata',{p_adjustment_ids:[changedAdjustment]})[0].event_action,'updated');
  const changedDelivery=f.json(`select json_agg(n) from app_notifications n where event_key like '%${changed.eventId}%'`);assert.ok(changedDelivery.every(n=>n.notification_type==='financial_input_updated'));assert.match(changedDelivery.find(n=>n.recipient_user_id===anna.profileId).body,/\$30\.00 → \$35\.00/);
 });
 await t.test('real STAFF role with custom permission bits still cannot read other Staff or salon finances',()=>{
  const earnings=f.rest(anna,`/pos_ticket_staff_earnings?salon_id=eq.${salon}`);assert.ok(earnings.length);assert.ok(earnings.every(row=>row.staff_id===staffA));
  for(const table of ['pos_daily_closings','pos_ticket_adjustments','pos_ticket_audit_logs']) assert.deepEqual(f.rest(anna,`/${table}?salon_id=eq.${salon}`),[]);
  const legacy=f.rest(anna,`/payroll_live_change_history?salon_id=eq.${salon}`);assert.ok(legacy.every(row=>row.staff_id===staffA));
  assert.ok(f.rest(manager,`/pos_daily_closings?salon_id=eq.${salon}`).length);
  const ledger=f.rpc(anna,'read_payroll_range_ledgers',{p_salon:salon,p_start:yesterday,p_end:today});
  assert.ok(ledger.periods.every(period=>(period.payments??[]).every(row=>row.staff_id===staffA)&&(period.lines??[]).every(row=>row.staff_id===staffA)));
 });
 await t.test('retired raw money correction commands cannot bypass the approved input paths',()=>{
  assert.equal(f.sql("select has_table_privilege('authenticated','public.pos_financial_adjustments','INSERT') or has_table_privilege('authenticated','public.pos_financial_correction_requests','INSERT')"),'f');
  assert.equal(f.sql("select has_function_privilege('authenticated','public.create_payroll_owner_adjustment(uuid,uuid,integer,uuid,jsonb,text)','EXECUTE')"),'f');
  const inventory=f.json(`select coalesce(json_agg(json_build_object('function',p.oid::regprocedure::text,'authenticated',has_function_privilege('authenticated',p.oid,'execute'),'anon',has_function_privilege('anon',p.oid,'execute'))),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.prosecdef and pg_get_functiondef(p.oid) ~* '(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+(public[.])?(pos_tickets|pos_ticket_items|pos_ticket_item_turn_parts|pos_ticket_staff_earnings|pos_payments)'`);
  f.save('source-writer-function-inventory.json',inventory);
 });
 await t.test('two real Postgres transactions cannot overwrite the same Staff day with a stale amount',async()=>{
  const member=randomUUID();f.sql(`insert into staff(id,salon_id,display_name) values('${member}','${salon}','Concurrent input fixture')`);
  let signalWritten;const written=new Promise(resolve=>{signalWritten=resolve;});
  const session=(sql,onOutput=()=>{})=>new Promise((resolve,reject)=>{
   const child=spawn(process.env.TEST_DOCKER_PATH||'C:/Program Files/Docker/Docker/resources/bin/docker.exe',['--context',process.env.TEST_DOCKER_CONTEXT||'desktop-linux','exec','-i',f.evidence.containers.db,'psql','-X','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-At'],{windowsHide:true});let output='',errors='';
   child.stdout.on('data',chunk=>{output+=chunk;onOutput(output);});child.stderr.on('data',chunk=>{errors+=chunk;});child.on('error',reject);child.on('exit',code=>resolve({code,output,errors}));child.stdin.end(sql);
  });
  const prefix=`begin;set local role authenticated;select set_config('request.jwt.claim.sub','${owner.authId}',true);`;
  const command=(amount,request,note)=>`select save_staff_day_financial_input('${salon}','${member}','${today}','${request}',0,0,0,${amount},0,'${note}');`;
  const first=session(prefix+command(10,randomUUID(),'First concurrent input')+"select 'FIRST_WRITTEN';select pg_sleep(0.7);commit;",output=>{if(output.includes('FIRST_WRITTEN'))signalWritten();});
  let deadline;try{await Promise.race([written,first.then(result=>{if(result.code!==0)throw Error(result.errors);}),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Concurrent fixture did not acquire its first write')),10000);})]);}finally{clearTimeout(deadline);}
  const second=session(prefix+command(20,randomUUID(),'Second concurrent input')+'commit;');
  const [a,b]=await Promise.all([first,second]);assert.equal(a.code,0,a.errors);assert.notEqual(b.code,0);assert.match(b.errors,/Staff day changed/);
  const state=f.rpc(owner,'read_staff_day_financial_input',{p_salon:salon,p_staff:member,p_date:today});assert.equal(Number(state.service_total),10);assert.equal(Number(state.revision),1);
  assert.equal(Number(f.sql(`select count(*) from financial_input_events where salon_id='${salon}' and kind='staff_day' and source_id='${member}'`)),1);
 });
 await t.test('history retains actor snapshot through account deletion without allowing financial edits',()=>{
  const actor=f.person('inputs-erased-actor');
  f.sql(`select set_config('request.jwt.claim.sub','${actor.authId}',false);select record_financial_input_event('${salon}','daily_report','${today}',null,'{}','{"cash_amount":1}','Retained business evidence','[]',null,false);select set_config('request.jwt.claim.sub','',false);`);
  const event=f.json(`select row_to_json(e) from financial_input_events e where actor_id='${actor.profileId}'`);assert.ok(event.actor_name);
  f.sql(`delete from users where id='${actor.profileId}'`);
  const retained=f.json(`select row_to_json(e) from financial_input_events e where id='${event.id}'`);assert.equal(retained.actor_id,null);assert.equal(retained.actor_name,event.actor_name);assert.deepEqual(retained.after_values,event.after_values);
  assert.throws(()=>f.sql(`update financial_input_events set note='Rewrite' where id='${event.id}'`),/immutable/);
 });
 f.save('financial-inputs-scenarios.json',{salon:'isolated fixture',schemaMigrations:f.evidence.migrationHashes.length,checks:'Owner scope, Staff isolation, retries, no-op, past inputs, independent tips and unchanged actual payment records'});
});
