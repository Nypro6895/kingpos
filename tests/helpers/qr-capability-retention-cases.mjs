import assert from 'node:assert/strict';import crypto from 'node:crypto';

export async function runQrCapabilityAndRetentionChecks(t,f,{owner,staffUser,account,salon,staff,services,visit}){
 const uuid=()=>crypto.randomUUID(),rpc=(who,name,args)=>f.rpc(who,name,args);
 const customerId=f.sql(`select customer_id from public.customer_visits where id='${visit}'`);
 const mutations=['service_relay_tickets','service_relay_offers','service_relay_lines','customer_visits','personal_qr_ready','personal_qr_ready_requests','app_notifications','pos_tickets','pos_ticket_staff_earnings','checkin_receipts','checkin_receipt_counters'];
 const snapshot=()=>f.json(`select jsonb_build_object(${mutations.map(name=>`'${name}',(select md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text,'[]')) from public.${name} r)`).join(',')})`);
 const key=(target=salon,active=true,cap=true)=>{const id=uuid();f.sql(`insert into public.pos_portable_access_keys(id,salon_id,access_id,passcode_salt,passcode_digest,is_active,capabilities) values('${id}','${target}','${uuid()}','fixture-salt','fixture-digest',${active},${cap?"array['portable.pos.use']":"array[]::text[]"})`);return{p_key:id,p_signature:f.sql(`select public.pos_portable_access_signature('${id}','fixture-digest')`)};};
 const ownVisits=[];
 const newVisit=()=>{if(ownVisits.length)f.sql(`update public.customer_visits set status='cancelled' where id in (${ownVisits.map(id=>`'${id}'`).join(',')}) and status in ('waiting','in_service','checkout')`);const id=uuid();f.sql(`insert into public.customer_visits(id,salon_id,customer_id,source,status) values('${id}','${salon}','${customerId}','walk_in','waiting');insert into public.service_relay_tickets(visit_id,salon_id,scan_mode) values('${id}','${salon}',true)`);ownVisits.push(id);return id;};
 const desk=id=>({p_salon:salon,p_visit:id,p_expected:Number(f.sql(`select revision from public.service_relay_tickets where visit_id='${id}'`)),p_lines:[{id:uuid(),staffId:staff,serviceId:services[0],amount:'17.25'}]});
 const ready=id=>({p_salon:salon,p_visit:id,p_staff:staff,p_chair:'Fixture chair',p_request:uuid()});
 const matrix=[];
 await t.test('both capability RPCs deny every invalid path before any persistent side effect',async()=>{
  assert.equal(rpc(staffUser,'user_has_salon_permission',{target_salon_id:salon,permission_codes:['tickets.manage']}),false);
  const other=uuid();f.sql(`insert into public.locations(id,account_id,name) values('${other}','${account}','Other matrix salon')`);
  const valid=key(),inactive=key(salon,false),wrong=key(other),missing=key(salon,true,false),target=newVisit();
  const cases=[['anon_without_key',null,{}],['staff_without_permission',staffUser,{}],['wrong_salon',null,wrong],['inactive_key',null,inactive],['bad_signature',null,{...valid,p_signature:'invalid'}],['missing_capability',null,missing]];
  for(const [name,who,auth] of cases)for(const [fn,args] of [['staff_scan_desk_save',desk(target)],['personal_qr_notify_ready',ready(target)]]){
   const before=snapshot(),r=f.http(3000,'/rpc/'+fn,'POST',{...args,...auth},who?.token);
   assert.ok(r.status>=400,`${name}/${fn} allowed`);assert.match(r.data.message,/Not authorized/);assert.deepEqual(snapshot(),before,`${name}/${fn} changed persistent state`);
   matrix.push({case:name,rpc:fn,status:r.status,result:'DENY',sideEffects:'none'});
  }
  for(const who of [null,staffUser])for(const fn of ['staff_scan_desk_save','personal_qr_notify_ready']){
   const id=newVisit(),args=fn==='staff_scan_desk_save'?desk(id):ready(id);rpc(who,fn,{...args,...valid});
   matrix.push({case:who?'staff_with_capability':'anon_with_capability',rpc:fn,result:'ALLOW'});
  }
  const revokedTarget=newVisit();f.sql(`update public.pos_portable_access_keys set is_active=false where id='${valid.p_key}'`);
  for(const [fn,args] of [['staff_scan_desk_save',desk(revokedTarget)],['personal_qr_notify_ready',ready(revokedTarget)]]){
   const before=snapshot(),r=f.http(3000,'/rpc/'+fn,'POST',{...args,...valid});assert.ok(r.status>=400);assert.match(r.data.message,/Not authorized/);assert.deepEqual(snapshot(),before);matrix.push({case:'revoked_previously_used_key',rpc:fn,result:'DENY',sideEffects:'none'});
  }
  f.save('capability-security-matrix.json',{cases:matrix,noExpiryAdded:true,scope:'Actual isolated Auth/PostgREST/RLS; persistent side-effect hashes cover eleven touched tables. Lifecycle status is a separately disclosed existing helper limitation.'});
 });
 await t.test('Owner paths, interleaved Ready retries and consumed requests preserve exact saved outcomes',()=>{
  const id=newVisit(),a=ready(id),b={...a,p_request:uuid(),p_chair:'Other fixture chair'};
  rpc(owner,'personal_qr_notify_ready',a);let before=snapshot();rpc(owner,'personal_qr_notify_ready',a);assert.deepEqual(snapshot(),before);
  rpc(owner,'personal_qr_notify_ready',b);before=snapshot();rpc(owner,'personal_qr_notify_ready',a);assert.deepEqual(snapshot(),before,'A/B/A retry must not restore old Ready or duplicate a notification');
  const changed=f.http(3000,'/rpc/personal_qr_notify_ready','POST',{...a,p_chair:'Changed payload'},owner.token);assert.ok(changed.status>=400);assert.deepEqual(snapshot(),before);
  f.sql(`delete from public.app_notifications where event_key='personal-ready:${a.p_request}';update public.customer_visits set status='in_service' where id='${id}'`);
  before=snapshot();rpc(owner,'personal_qr_notify_ready',a);rpc(owner,'personal_qr_notify_ready',b);assert.deepEqual(snapshot(),before,'Consumed retry and removed notification must not revive Ready');
  const ticket=newVisit(),args=desk(ticket);rpc(owner,'staff_scan_desk_save',args);before=snapshot();const stale=f.http(3000,'/rpc/staff_scan_desk_save','POST',args,owner.token);assert.ok(stale.status>=400);assert.deepEqual(snapshot(),before,'old revision must not apply twice');
 });
 await t.test('Staff deletion retains audit attribution and exact actual payment facts under Owner RLS',()=>{
  const removed=uuid();f.sql(`insert into public.staff(id,salon_id,display_name) values('${removed}','${salon}','Original Fixture Staff')`);
  const args={p_salon:salon,p_staff:removed,p_start:'2001-01-01',p_end:'2001-01-15',p_cycle:'semi_monthly'},blank={bonus_amount:0,check_number:null,note:null},first={bonus_amount:10,check_number:'Fixture',note:'Original fixture note'},second={...first,bonus_amount:25,note:'Revised fixture note'};
  rpc(owner,'save_owner_live_payroll_input',{...args,p_values:first,p_expected:blank});rpc(owner,'save_owner_live_payroll_input',{...args,p_values:second,p_expected:first});
  const before=f.json(`select jsonb_agg(to_jsonb(h) order by h.id) from public.payroll_live_change_history h where staff_id='${removed}'`);assert.equal(before.length,2);
  assert.ok(before.every(h=>h.staff_snapshot.id===removed&&h.staff_snapshot.displayName==='Original Fixture Staff'));
  const input=uuid(),base=uuid(),payment=uuid();
  f.sql(`insert into public.payroll_close_inputs(id,salon_id,period_start,period_end,cycle_type,timezone_iana,closed_at,input_packet,input_sha256) values('${input}','${salon}','2001-01-01','2001-01-15','semi_monthly','America/Chicago',now(),'{}','synthetic-fixture');
   insert into public.payroll_period_bases(id,input_id,salon_id,period_start,period_end,cycle_type,original_snapshot,engine_version) values('${base}','${input}','${salon}','2001-01-01','2001-01-15','semi_monthly','{}','synthetic-fixture');
   insert into public.payroll_base_staff_lines(base_id,salon_id,staff_id,original_line) values('${base}','${salon}','${removed}','{"staff_name":"Original Fixture Staff","final_cash_amount":500}');
   insert into public.payroll_recorded_payments(id,base_id,salon_id,staff_id,request_id,actor_id,revision_at_payment,revision,cash_amount,check_amount,paid_at,note) values('${payment}','${base}','${salon}','${removed}','${uuid()}','${owner.profileId}',0,1,500,0,'2001-01-16T12:00:00Z','Synthetic previously recorded payment');`);
  const paymentBefore=f.json(`select to_jsonb(p) from public.payroll_recorded_payments p where id='${payment}'`);
  assert.throws(()=>f.sql(`begin;select set_config('request.jwt.claim.sub','${owner.authId}',true);delete from public.staff where id='${removed}';commit;`),/protected data exists/,'existing financial-history delete protection must remain');
  f.sql(`update public.staff set is_active=false where id='${removed}'`);
  for(const h of before){const after=f.json(`select to_jsonb(h) from public.payroll_live_change_history h where id='${h.id}'`);assert.deepEqual(after,h);}
  assert.deepEqual(f.json(`select to_jsonb(p) from public.payroll_recorded_payments p where id='${payment}'`),paymentBefore);
  const ownerRows=f.rest(owner,`/payroll_live_change_history?salon_id=eq.${salon}&source_id=eq.${before[0].source_id}`);assert.ok(ownerRows.some(h=>h.staff_snapshot.id===removed&&h.staff_snapshot.displayName==='Original Fixture Staff'));
  assert.equal(f.rest(staffUser,`/payroll_live_change_history?source_id=eq.${before[0].source_id}`).length,0,'retention must not expand Staff read rights');
  const record=rpc(owner,'read_payroll_period_ledger',{p_salon:salon,p_start:'2001-01-01',p_end:'2001-01-15'});assert.ok(record.payments.some(p=>p.id===payment&&p.note===paymentBefore.note&&Number(p.cash_amount)===500));
  const disposable=uuid();f.sql(`insert into public.staff(id,salon_id,display_name) values('${disposable}','${salon}','Deleted Fixture Staff')`);
  const setting={pay_type:'fixed',commission_rate:0,fixed_pay_amount:123,check_rate:50,tax_rate:10,apply_tax_to_fixed_pay:false,tax_tips:true,tax_bonus:true,cash_to_tax_company:false,tax_company_enabled:false,tip_payout_method:'cash',bonus_payout_method:'cash',legal_name:'Fixture',effective_to:null};
  const initial=rpc(owner,'save_owner_live_payroll_setting',{p_salon:salon,p_staff:disposable,p_effective:'2001-01-01',p_values:setting,p_expected_id:null,p_expected_updated_at:null});
  rpc(owner,'save_owner_live_payroll_setting',{p_salon:salon,p_staff:disposable,p_effective:'2001-01-01',p_values:{...setting,fixed_pay_amount:150},p_expected_id:initial.id,p_expected_updated_at:initial.updated_at});
  const deletedPayment=uuid();f.sql(`insert into public.payroll_base_staff_lines(base_id,salon_id,staff_id,original_line) values('${base}','${salon}','${disposable}','{"staff_name":"Deleted Fixture Staff","final_cash_amount":23}');
   insert into public.payroll_recorded_payments(id,base_id,salon_id,staff_id,request_id,actor_id,revision_at_payment,revision,cash_amount,check_amount,paid_at,note) values('${deletedPayment}','${base}','${salon}','${disposable}','${uuid()}','${owner.profileId}',1,2,23,0,'2001-01-16T12:00:00Z','Deleted fixture staff payment note');`);
  const deletedPaymentBefore=f.json(`select to_jsonb(p) from public.payroll_recorded_payments p where id='${deletedPayment}'`);
  const deletableBefore=f.json(`select jsonb_agg(to_jsonb(h) order by h.id) from public.payroll_live_change_history h where staff_id='${disposable}'`);assert.ok(deletableBefore.length>0);
  f.sql(`begin;select set_config('request.jwt.claim.sub','${owner.authId}',true);select set_config('request.jwt.claims','{"sub":"${owner.authId}","role":"authenticated"}',true);delete from public.staff where id='${disposable}';commit;`);
  assert.equal(Number(f.sql(`select count(*) from public.staff where id='${disposable}'`)),0);
  for(const h of deletableBefore)assert.deepEqual(f.json(`select to_jsonb(h) from public.payroll_live_change_history h where id='${h.id}'`),{...h,staff_id:null});
  const cascade=f.json(`select jsonb_agg(to_jsonb(h)) from public.payroll_live_change_history h where staff_snapshot->>'id'='${disposable}' and after_values='{}'::jsonb`);assert.equal(cascade.length,1);assert.equal(Number(cascade[0].before_values.fixed_pay_amount),150);
  assert.equal(cascade[0].actor_id,owner.profileId);assert.equal(cascade[0].staff_snapshot.displayName,'Deleted Fixture Staff');
  assert.deepEqual(f.json(`select to_jsonb(p) from public.payroll_recorded_payments p where id='${payment}'`),paymentBefore);
  assert.deepEqual(f.json(`select to_jsonb(p) from public.payroll_recorded_payments p where id='${deletedPayment}'`),deletedPaymentBefore);
  assert.ok(rpc(owner,'read_payroll_period_ledger',{p_salon:salon,p_start:'2001-01-01',p_end:'2001-01-15'}).payments.some(p=>p.id===deletedPayment&&p.staff_id===disposable&&p.note===deletedPaymentBefore.note));
  assert.ok(f.rest(owner,`/payroll_live_change_history?salon_id=eq.${salon}`).some(h=>h.staff_id===null&&h.staff_snapshot?.id===disposable&&h.staff_snapshot.displayName==='Deleted Fixture Staff'));
  f.save('staff-deletion-retention.json',{passed:true,protectedFinancialDeleteDenied:true,softRemovalRetainsNotes:true,actualDisposableStaffDeleted:true,historyRowsPreserved:before.length+deletableBefore.length,notesAmountsActorSourceDatesByteEquivalent:true,originalStaffIdentityPreserved:true,actualPaymentByteEquivalent:true,ownerRead:true,otherStaffDenied:true});
 });
}
