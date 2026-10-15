import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import cp from 'node:child_process';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

test('booking notifications use isolated recipients, protected queues and controlled retries', {
  skip:process.env.RUN_ISOLATED_SUPABASE!=='1'?'Set RUN_ISOLATED_SUPABASE=1; requires cached images':false,timeout:900000,
},async t=>{
  const f=await startIsolatedSupabase('booking-notifications');t.after(()=>f.close());
  const report={startedAt:new Date().toISOString(),testSourceSha256:crypto.createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex'),transport:'Real Auth user JWT/PostgREST; queue worker SQL driven by fixture admin; no service-role key or real provider',cases:[],captures:[]};
  async function check(name,run){await t.test(name,async()=>{try{await run();report.cases.push({name,result:'passed'});}catch(error){report.cases.push({name,result:'failed',message:f.redact(error.message)});throw error;}finally{f.save('booking-notification-results.json',report);}});}
  const ownerA = f.person('owner-a'), ownerB = f.person('owner-b');
  const customerA = f.person('customer-a'), customerB = f.person('customer-b');
  const staffA = f.person('staff-a'), staffB = f.person('staff-b'), otherStaffA = f.person('unassigned-a');
  function salon(owner, staffUser, suffix) {
    const account = f.rpc(owner, 'ensure_personal_account_for_current_user', { p_account_name: `Drayko ${suffix} fixture` })[0].account_id;
    const id = f.rpc(owner, 'create_account_salon_with_owner_staff', { p_account_id: account, p_create_request_key: crypto.randomUUID(),
      p_name: `Drayko ${suffix}`, p_owner_is_staff: false, p_phone: null, p_address_line1: null, p_address_line2: null, p_city: null, p_state: null, p_postal_code: null, p_country: 'US' }).salon_id;
    const staff = f.rest(owner, '/staff', 'POST', { salon_id: id, account_user_id: staffUser.profileId, display_name: `Staff ${suffix}`, first_name: 'Fixture', last_name: suffix, is_active: true })[0].id;
    const service = f.rest(owner, '/services', 'POST', { salon_id: id, name: `Service ${suffix}`, duration_minutes: 45, base_price: 20, is_active: true })[0].id;
    f.rest(owner, '/staff_service_assignments', 'POST', { salon_id: id, staff_id: staff, service_id: service, is_active: true });
    f.rest(owner, '/staff_availability_rules', 'POST', Array.from({ length: 7 }, (_, day) => ({ salon_id: id, staff_id: staff,
      rule_type: 'working', day_of_week: day, starts_at_local: '08:00', ends_at_local: '18:00', is_active: true })));
    f.rest(owner, `/booking_settings?salon_id=eq.${id}`, 'PATCH', { booking_enabled: true, online_booking_visible: true,
      confirmation_mode: 'request_confirmation', timezone_iana: 'America/Chicago', default_cleanup_buffer_minutes: 15,
      minimum_lead_time_minutes: 120, maximum_advance_window_days: 60, slot_interval_minutes: 15, guest_booking_enabled: true,
      confirmation_email_enabled: false, confirmation_sms_enabled: false, reminder_enabled: false });
    return { id, account, staff, service, owner };
  }
  const a = salon(ownerA, staffA, 'A'), b = salon(ownerB, staffB, 'B');
  const unassigned = f.rest(ownerA, '/staff', 'POST', { salon_id: a.id, account_user_id: otherStaffA.profileId, display_name: 'Other A', is_active: true })[0].id;
  assert.ok(unassigned);
  const base = f.sql("select ((((now() at time zone 'America/Chicago')::date+5)+time '09:00') at time zone 'America/Chicago')::text");
  const at = minutes => new Date(+new Date(base) + minutes * 60000).toISOString();
  const args = (s, who, minute, key = crypto.randomUUID()) => ({ p_salon_id: s.id, p_customer_first_name: 'Fixture', p_customer_last_name: who?.kind || 'Guest',
    p_customer_phone: who === customerA ? "+15005550101" : "+15005550102", p_customer_email: who?.email || 'guest@example.invalid', p_start_at: at(minute), p_end_at: at(minute + 60),
    p_lines: [{ service_id: s.service, assigned_staff_id: s.staff, scheduled_start_at: at(minute), scheduled_end_at: at(minute + 60), cleanup_buffer_minutes: 15, display_order: 0 }],
    p_idempotency_key: key });

  f.rest(ownerA, '/booking_settings?salon_id=eq.'+a.id, 'PATCH', {confirmation_email_enabled:true,confirmation_sms_enabled:true,reminder_enabled:true});
  const input=args(a,customerA,0),created=f.rpc(customerA,'create_public_booking',input),id=created.booking_id;assert.equal(created.ok,true);
  const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
  const outbox=bookingId=>f.json("select coalesce(json_agg(m order by created_at,id),'[]') from booking_message_outbox m where booking_id="+literal(bookingId));
  const notices=bookingId=>f.json("select coalesce(json_agg(n order by created_at,id),'[]') from app_notifications n where booking_id="+literal(bookingId));
  const claim=(email=true,sms=false,limit=20)=>f.json('select coalesce(json_agg(m),\'[]\') from claim_booking_messages('+limit+','+email+','+sms+')m');
  const finish=(rows,state='accepted')=>{for(const row of rows)f.sql('update booking_message_outbox set state='+literal(state)+',updated_at=now() where id='+literal(row.id));};
  const denied=r=>r.status>=400||r.data?.ok===false||Array.isArray(r.data)&&r.data.length===0;
  f.save('booking-notification-schema.json',{functions:f.json("select json_agg(p) from (select proname,proacl::text,pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace and proname in ('notify_public_booking_created','notify_booking_change','enqueue_booking_message','claim_booking_messages','enqueue_notification_reminders','booksms_reserve_send'))p")});
  await check('new request notifies only its owner and assigned staff with pending wording',()=>{
    const n=notices(id);assert.deepEqual(n.map(x=>x.recipient_user_id).sort(),[ownerA.profileId,staffA.profileId].sort());
    assert.ok(n.every(x=>x.title==='New booking request'&&x.salon_id===a.id));
    assert.ok(n.some(x=>x.href.startsWith('/bookings?')));assert.ok(n.some(x=>x.href.startsWith('/staff/appointments?')));
    const q=outbox(id);assert.equal(q.length,1);assert.equal(q[0].channel,'email');assert.equal(q[0].recipient,customerA.email);assert.equal(q[0].state,'pending');assert.match(q[0].message,/awaiting salon confirmation/);
  });
  await check('idempotent booking replay creates neither duplicate notices nor email jobs',()=>{
    const n=notices(id).map(x=>x.id),q=outbox(id).map(x=>x.id);assert.equal(f.rpc(customerA,'create_public_booking',input).duplicate,true);
    assert.deepEqual(notices(id).map(x=>x.id),n);assert.deepEqual(outbox(id).map(x=>x.id),q);
  });
  await check('foreign owner, customer and anonymous cannot read the private outbox',()=>{
    assert.equal(f.rest(ownerA,'/booking_message_outbox?booking_id=eq.'+id+'&select=id').length,1);
    for(const user of [ownerB,customerA,customerB,null])assert.ok(denied(f.http(3000,'/booking_message_outbox?booking_id=eq.'+id+'&select=*','GET',undefined,user?.token)));
  });
  await check('only recipients can read in-app notices; outsiders cannot forge them',()=>{
    for(const user of [ownerA,staffA])assert.equal(f.rest(user,'/app_notifications?booking_id=eq.'+id+'&select=id').length,1);
    for(const user of [ownerB,customerB,staffB,otherStaffA])assert.equal(f.rest(user,'/app_notifications?booking_id=eq.'+id+'&select=id').length,0);
    assert.ok(denied(f.http(3000,'/app_notifications','POST',{recipient_user_id:ownerA.profileId,recipient_kind:'owner_manager',notification_type:'booking_change',booking_id:id,salon_id:a.id,title:'Forged fixture',href:'/bookings'},customerB.token)));
  });
  await check('normal users and anonymous callers cannot invoke the message worker',()=>{
    for(const user of [ownerA,customerA,null])assert.ok(denied(f.http(3000,'/rpc/claim_booking_messages','POST',{},user?.token)));
  });
  await check('unconfigured provider holds the queue without attempting delivery',()=>{
    assert.deepEqual(claim(false,false),[]);const q=outbox(id);assert.equal(q[0].state,'unconfigured');assert.equal(q[0].attempts,0);
  });
  await check('configured retry claims once and accepted jobs never automatically repeat',()=>{
    const first=claim();assert.equal(first.length,1);assert.equal(first[0].recipient,customerA.email);assert.equal(first[0].attempts,1);assert.deepEqual(claim(),[]);finish(first);assert.deepEqual(claim(),[]);
  });
  await check('staff confirmation sends accurate customer status and resolves request notices',()=>{
    assert.equal(f.rpc(staffA,'confirm_assigned_booking',{p_booking_id:id}).ok,true);
    const n=notices(id);assert.ok(n.some(x=>x.recipient_user_id===customerA.profileId&&x.title==='Appointment confirmed'));
    assert.ok(n.filter(x=>x.notification_type==='public_booking_created').every(x=>x.title==='New booking confirmed'));
    const pending=outbox(id).filter(x=>x.state==='pending');assert.equal(pending.length,1);assert.match(pending[0].message,/is confirmed/);
    assert.equal(n.some(x=>[ownerB.profileId,staffB.profileId,customerB.profileId].includes(x.recipient_user_id)),false);
  });
  await check('reschedule skips the superseded email and claims only the latest appointment time',()=>{
    const before=notices(id).map(x=>x.id);assert.equal(f.rpc(customerA,'reschedule_customer_booking',{p_booking_id:id,p_start_at:at(60)}).ok,true);
    const current=claim();assert.equal(current.length,1);assert.equal(current[0].recipient,customerA.email);assert.match(current[0].message,/is confirmed/);
    assert.ok(outbox(id).some(x=>x.state==='skipped'));finish(current);
    report.captures.push({event:'customer_rescheduled',newInAppRecipientKinds:notices(id).filter(x=>!before.includes(x.id)).map(x=>x.recipient_kind)});
  });
  await check('cancellation produces one customer email with cancelled wording',()=>{
    const before=notices(id).map(x=>x.id);assert.equal(f.rpc(customerA,'cancel_customer_booking',{p_booking_id:id}).ok,true);
    const current=claim();assert.equal(current.length,1);assert.equal(current[0].recipient,customerA.email);assert.match(current[0].message,/is cancelled/);finish(current);assert.deepEqual(claim(),[]);
    report.captures.push({event:'customer_cancelled',newInAppRecipientKinds:notices(id).filter(x=>!before.includes(x.id)).map(x=>x.recipient_kind)});
  });
  let reassigned;
  await check('queued messages never go to the previous customer after reassignment',()=>{
    const booked=f.rpc(customerA,'create_public_booking',args(a,customerA,180));assert.equal(booked.ok,true);reassigned=booked.booking_id;
    const newCustomer=f.rest(ownerA,'/customers','POST',{location_id:a.id,name:'Fixture replacement',email:'replacement@example.invalid',status:'active'})[0];
    f.rest(ownerA,'/bookings?id=eq.'+reassigned,'PATCH',{customer_id:newCustomer.id});
    const current=claim();assert.equal(current.length,1);assert.equal(current[0].recipient,'replacement@example.invalid');
    assert.ok(outbox(reassigned).some(x=>x.recipient===customerA.email&&x.state==='skipped'));
  });
  await check('interrupted sending becomes unknown and is not automatically resent',()=>{
    f.sql("update booking_message_outbox set updated_at=now()-interval '6 minutes' where booking_id="+literal(reassigned)+" and state='sending'");
    assert.deepEqual(claim(),[]);assert.ok(outbox(reassigned).some(x=>x.state==='unknown'));assert.deepEqual(claim(),[]);
  });
  let failedBooking;
  await check('failed provider outcomes are retained for review instead of automatic duplicate sends',()=>{
    const booked=f.rpc(customerA,'create_public_booking',args(a,customerA,300));assert.equal(booked.ok,true);failedBooking=booked.booking_id;
    const current=claim();assert.equal(current.length,1);finish(current,'failed');assert.deepEqual(claim(),[]);assert.equal(outbox(failedBooking)[0].state,'failed');
  });
  await check('disabled email and unentitled BookSMS do not enqueue new messages',()=>{
    f.rest(ownerA,'/booking_settings?salon_id=eq.'+a.id,'PATCH',{confirmation_email_enabled:false});
    const booked=f.rpc(customerA,'create_public_booking',args(a,customerA,420));assert.equal(booked.ok,true);assert.deepEqual(outbox(booked.booking_id),[]);
    f.rest(ownerA,'/booking_settings?salon_id=eq.'+a.id,'PATCH',{confirmation_email_enabled:true});
  });
  await check('reminders are deduplicated and only queued for eligible future confirmed bookings',()=>{
    // Synthetic clock scenario only; no real appointments or delivery worker.
    f.sql("update bookings set status='confirmed',confirmation_status='confirmed',start_at=now()+interval '12 hours',end_at=now()+interval '13 hours',created_at=now()-interval '2 hours' where id="+literal(failedBooking));
    let current=claim();const reminders=current.filter(x=>x.event_key.startsWith('reminder:'));assert.equal(reminders.length,1);assert.equal(reminders[0].recipient,customerA.email);finish(current);
    assert.deepEqual(claim(),[]);assert.equal(outbox(failedBooking).filter(x=>x.event_key.startsWith('reminder:')).length,1);
    const added=Number(f.sql('select enqueue_notification_reminders(100)'));assert.equal(added,1);assert.equal(Number(f.sql('select enqueue_notification_reminders(100)')),0);
    assert.equal(notices(failedBooking).filter(x=>x.notification_type==='booking_reminder').length,1);
  });
  await check('two concurrent workers claim disjoint queue rows',async()=>{
    const one=f.rpc(customerA,'create_public_booking',args(a,customerA,0)),two=f.rpc(customerB,'create_public_booking',args(a,customerB,60));assert.equal(one.ok,true);assert.equal(two.ok,true);
    const docker=process.env.TEST_DOCKER_PATH||'C:/Program Files/Docker/Docker/resources/bin/docker.exe';
    const child=cp.spawn(docker,['--context',process.env.TEST_DOCKER_CONTEXT||'desktop-linux','exec','-i',f.evidence.containers.db,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='',error='';const completed=new Promise((resolve,reject)=>{child.on('error',reject);child.stderr.on('data',d=>{error+=d;});child.on('close',code=>resolve({code,error}));});
    let held;
    try{
      const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Worker claim did not acquire row lock')),10000);child.stdout.on('data',d=>{output+=d;if(output.includes('HELD')){clearTimeout(timer);resolve();}});});
      child.stdin.write("begin;select id from claim_booking_messages(1,true,false);select 'HELD';\n");await ready;
      held=output.trim().split(/\r?\n/).find(x=>/^[0-9a-f-]{36}$/.test(x));assert.ok(held);
      const second=claim(true,false,20);assert.equal(second.length,1);assert.notEqual(second[0].id,held);finish(second);
    }finally{child.stdin.end('commit;\n');const done=await completed;assert.equal(done.code,0,done.error);}
    finish([{id:held}]);assert.deepEqual(claim(),[]);
  });
  await check('muted staff do not receive new booking request notices',()=>{
    f.rpc(staffA,'own_staff_booking_preferences',{p_salon_id:a.id,p_notifications:false});
    const booked=f.rpc(customerA,'create_public_booking',args(a,customerA,480));assert.equal(booked.ok,true);
    assert.equal(notices(booked.booking_id).some(x=>x.recipient_user_id===staffA.profileId),false);assert.ok(notices(booked.booking_id).some(x=>x.recipient_user_id===ownerA.profileId));
  });
  await check('BookSMS entitlement, recipient and allowance are enforced without sending',()=>{
    f.sql("insert into booksms_subscriptions(salon_id,installed,paid_until,encrypted_config,public_config,monthly_limit) values ("+literal(b.id)+",true,now()+interval '1 day','fixture-not-real-encryption','{\"enabled\":true,\"confirmation\":true,\"reminders\":true}',1)");
    f.rest(ownerB,'/booking_settings?salon_id=eq.'+b.id,'PATCH',{confirmation_email_enabled:false,confirmation_sms_enabled:true});
    const booked=f.rpc(customerB,'create_public_booking',args(b,customerB,0));assert.equal(booked.ok,true);
    const sms=outbox(booked.booking_id);assert.equal(sms.length,1);assert.equal(sms[0].channel,'sms');assert.equal(sms[0].recipient,'+15005550102');
    const claimed=claim(true,true);assert.equal(claimed.filter(x=>x.booking_id===booked.booking_id).length,1);finish(claimed);
    assert.equal(f.sql('select booksms_reserve_send('+literal(b.id)+',false)'),'t');assert.equal(f.sql('select booksms_reserve_send('+literal(b.id)+',false)'),'f');
    assert.ok(denied(f.http(3000,'/rpc/booksms_reserve_send','POST',{p_salon:b.id,p_reminder:false},customerB.token)));
  });
  await check('disabling BookSMS skips queued SMS and blocks new SMS jobs',()=>{
    const booked=f.rpc(customerB,'create_public_booking',args(b,customerB,60));assert.equal(booked.ok,true);assert.equal(outbox(booked.booking_id).length,1);
    f.sql("update booksms_subscriptions set public_config=public_config||'{\"enabled\":false}'::jsonb where salon_id="+literal(b.id));
    assert.deepEqual(claim(true,true),[]);assert.equal(outbox(booked.booking_id)[0].state,'skipped');
    const later=f.rpc(customerB,'create_public_booking',args(b,customerB,120));assert.equal(later.ok,true);assert.deepEqual(outbox(later.booking_id),[]);
  });
  for(const [name,user] of [['anonymous',null],['foreign customer',customerB],['foreign owner',ownerB]]){
    await check(name+' cannot invoke notification producer for another salon booking',()=>{
      const before=notices(id).length;
      const r=f.http(3000,'/rpc/notify_booking_change','POST',{target_booking_id:id,p_change_type:'cancelled'},user?.token);
      report.captures.push({event:'unauthorized_change_rpc',actor:name,httpStatus:r.status,noticesAdded:notices(id).length-before});
      assert.ok(denied(r),'Notification producer accepts unauthorized caller');assert.equal(notices(id).length,before);
    });
  }
  for(const [name,user] of [['anonymous',null],['foreign customer',customerB],['foreign owner',ownerB]]){
    await check(name+' cannot directly reissue new-booking notices for another salon',()=>{
      f.sql("update app_notifications set read_at=now() where booking_id="+literal(id)+" and notification_type='public_booking_created'");
      const readBefore=notices(id).filter(x=>x.notification_type==='public_booking_created'&&x.read_at!==null).length;
      const r=f.http(3000,'/rpc/notify_public_booking_created','POST',{target_booking_id:id},user?.token);
      const readAfter=notices(id).filter(x=>x.notification_type==='public_booking_created'&&x.read_at!==null).length;
      report.captures.push({event:'unauthorized_created_rpc',actor:name,httpStatus:r.status,readNoticesReset:readBefore-readAfter});
      assert.ok(denied(r),'Internal new-booking notification helper is externally callable');
    });
  }
  let ownerBooking;
  await check('owner workspace update retains its authenticated notification call',()=>{
    f.rpc(staffA,'own_staff_booking_preferences',{p_salon_id:a.id,p_notifications:true});
    const booked=f.rpc(customerA,'create_public_booking',args(a,customerA,1440));assert.equal(booked.ok,true);ownerBooking=booked.booking_id;
    const before=f.rest(ownerA,'/bookings?id=eq.'+ownerBooking+'&select=updated_at')[0];
    assert.equal(f.rpc(ownerA,'save_pos_workspace_booking',{p_booking:ownerBooking,p_expected:before.updated_at,p_changes:{command:'confirm'}}),ownerBooking);
    const count=notices(ownerBooking).length;
    assert.equal(f.http(3000,'/rpc/notify_booking_change','POST',{target_booking_id:ownerBooking,p_change_type:'status_confirmed',p_actor_user_id:ownerA.profileId},ownerA.token).status,204);
    assert.ok(notices(ownerBooking).length>count);assert.ok(notices(ownerBooking).some(x=>x.recipient_user_id===customerA.profileId&&x.title==='Appointment confirmed'));
  });
  await check('assigned staff service start and completion keep internal notifications',()=>{
    const line=f.rest(ownerA,'/booking_lines?booking_id=eq.'+ownerBooking+'&select=id')[0].id;
    assert.equal(f.rpc(staffA,'start_assigned_booking_line',{p_booking_line_id:line}).ok,true);
    assert.equal(f.rpc(staffA,'complete_assigned_booking_line',{p_booking_line_id:line}).ok,true);
    assert.equal(f.rest(ownerA,'/bookings?id=eq.'+ownerBooking+'&select=status')[0].status,'completed');
    const titles=notices(ownerBooking).filter(x=>x.recipient_user_id===customerA.profileId).map(x=>x.title);
    assert.ok(titles.includes('Appointment started'));assert.ok(titles.includes('Appointment completed'));
  });
  await check('anonymous guest creation still calls the private creation notifier internally',()=>{
    const booked=f.rpc(null,'create_public_booking',args(a,null,1560));assert.equal(booked.ok,true);assert.ok(booked.manage_token);
    const n=notices(booked.booking_id);assert.ok(n.some(x=>x.recipient_user_id===ownerA.profileId));assert.ok(n.some(x=>x.recipient_user_id===staffA.profileId));
    assert.ok(n.every(x=>x.notification_type==='public_booking_created'&&x.salon_id===a.id));
  });
  await check('portable POS capability retains create, confirm and cancel without a user JWT',()=>{
    const key=crypto.randomUUID();
    f.sql('insert into pos_settings(salon_id) values ('+literal(a.id)+') on conflict (salon_id) do nothing');
    f.sql("insert into pos_portable_access_keys(id,salon_id,access_id,passcode_salt,passcode_digest,capabilities) values ("+literal(key)+','+literal(a.id)+','+literal(crypto.randomUUID())+",'fixture','fixture',array['portable.book.view','portable.book.create','portable.book.cancel','portable.pos.use'])");
    const signature=f.sql('select pos_portable_access_signature('+literal(key)+",'fixture')");
    const booked=f.rpc(null,'replay_pos_portable_operation',{p_key_id:key,p_session_signature:signature,p_operation_id:crypto.randomUUID(),p_kind:'booking',p_occurred_at:new Date().toISOString(),p_payload:{customerName:'Portable fixture',customerPhone:'+15005550103',customerEmail:'portable@example.invalid',serviceIds:[a.service],staffId:a.staff,startAt:at(1800)}});assert.ok(booked.id);
    const confirmed=f.rpc(null,'manage_pos_portable_booking',{p_key_id:key,p_session_signature:signature,p_booking_id:booked.id,p_action:'confirm'});assert.equal(confirmed.status,'confirmed');
    const cancelled=f.rpc(null,'manage_pos_portable_booking',{p_key_id:key,p_session_signature:signature,p_booking_id:booked.id,p_action:'cancel',p_payload:{reason:'Fixture cancellation',updatedAt:confirmed.updatedAt}});assert.equal(cancelled.status,'cancelled');
    assert.ok(outbox(booked.id).some(x=>x.recipient==='portable@example.invalid'));
    assert.equal(f.rpc(null,'manage_pos_portable_booking',{p_key_id:key,p_session_signature:signature,p_booking_id:booked.id,p_action:'read'}).id,booked.id);
    const foreign=f.rpc(customerB,'create_public_booking',args(b,customerB,1440));assert.equal(foreign.ok,true);
    assert.ok(denied(f.http(3000,'/rpc/manage_pos_portable_booking','POST',{p_key_id:key,p_session_signature:signature,p_booking_id:foreign.booking_id,p_action:'read'},undefined)));
  });
  await check('own customer, unassigned and foreign staff cannot spoof an owner notification actor',()=>{
    const count=notices(ownerBooking).length;
    for(const user of [customerA,otherStaffA,staffB])assert.ok(denied(f.http(3000,'/rpc/notify_booking_change','POST',{target_booking_id:ownerBooking,p_change_type:'cancelled',p_actor_user_id:ownerA.profileId,p_old_staff_ids:[a.staff],p_new_staff_ids:[a.staff]},user.token)));
    assert.equal(notices(ownerBooking).length,count);
  });
  await check('deactivated assigned staff loses direct notification authority',()=>{
    f.rest(ownerA,'/staff?id=eq.'+a.staff,'PATCH',{is_active:false});
    try{assert.ok(denied(f.http(3000,'/rpc/notify_booking_change','POST',{target_booking_id:ownerBooking,p_change_type:'updated'},staffA.token)));}
    finally{f.rest(ownerA,'/staff?id=eq.'+a.staff,'PATCH',{is_active:true});}
  });
  await check('owner and staff cannot directly reopen new-booking notices through the internal helper',()=>{
    f.sql("update app_notifications set read_at=now() where booking_id="+literal(ownerBooking)+" and notification_type='public_booking_created'");
    const before=notices(ownerBooking);
    for(const user of [ownerA,staffA])assert.ok(denied(f.http(3000,'/rpc/notify_public_booking_created','POST',{target_booking_id:ownerBooking},user.token)));
    assert.deepEqual(notices(ownerBooking),before);
  });
  await check('custom booking.manage role remains authorized only in its active salon membership',()=>{
    const manager=f.person('custom-booking-manager'),role=crypto.randomUUID();
    f.sql('insert into roles(id,account_id,name,code) values ('+literal(role)+','+literal(a.account)+",'Fixture booking manager','FIXTURE_BOOKING_MANAGER')");
    f.sql('insert into role_permissions(role_id,permission_id) select '+literal(role)+"::uuid,id from permissions where code='booking.manage'");
    f.sql('insert into salon_memberships(account_id,salon_id,user_id,role_id,status) values ('+literal(a.account)+','+literal(a.id)+','+literal(manager.profileId)+','+literal(role)+",'active')");
    assert.equal(f.http(3000,'/rpc/notify_booking_change','POST',{target_booking_id:ownerBooking,p_change_type:'updated'},manager.token).status,204);
    const foreign=f.sql('select id from bookings where salon_id='+literal(b.id)+' order by created_at limit 1');
    assert.ok(denied(f.http(3000,'/rpc/notify_booking_change','POST',{target_booking_id:foreign,p_change_type:'updated'},manager.token)));
    f.sql("update salon_memberships set status='inactive' where salon_id="+literal(a.id)+' and user_id='+literal(manager.profileId));
    assert.ok(denied(f.http(3000,'/rpc/notify_booking_change','POST',{target_booking_id:ownerBooking,p_change_type:'updated'},manager.token)));
  });
  await check('notification helper execution ACLs exclude anonymous and direct creation calls',()=>{
    const change='public.notify_booking_change(uuid,text,uuid,uuid[],uuid[])',created='public.notify_public_booking_created(uuid)';
    assert.equal(f.sql("select has_function_privilege('anon',"+literal(change)+",'execute')"),'f');
    assert.equal(f.sql("select has_function_privilege('authenticated',"+literal(change)+",'execute')"),'t');
    for(const role of ['anon','authenticated'])assert.equal(f.sql('select has_function_privilege('+literal(role)+','+literal(created)+",'execute')"),'f');
  });
  await check('reapplying the guard preserves installed functions, ACLs and notification rows',()=>{
    const snapshot=()=>f.json("select json_agg(p order by signature) from (select oid::regprocedure::text signature,proacl::text,prosecdef,proconfig,pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace and prokind='f') p");
    const before=snapshot(),rows=notices(ownerBooking),migration=fs.readFileSync(new URL('../supabase/migrations/20261015173000_booking_notification_access_guards.sql',import.meta.url),'utf8');
    f.sql(migration);f.sql(migration);assert.deepEqual(snapshot(),before);assert.deepEqual(notices(ownerBooking),rows);
  });

  report.finishedAt=new Date().toISOString();report.passed=report.cases.every(x=>x.result==='passed');f.save('booking-notification-results.json',report);
});
