import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {historyNotificationFixture} from './helpers/history-notification-fixture.mjs';

const {db,row,actor,date,past,uid,sale,save}=await historyNotificationFixture();
await actor(uid(90));
const legacy=(await row('select public.submit_owner_workspace_receipt_core($1,null,$2::jsonb,$3) r',[uid(1),JSON.stringify({tipAmount:8}),date])).r;
const legacyEvent=await row('select * from public.financial_input_events where source_id=$1',[legacy.ticketId]);
await db.query('update public.app_notifications set read_at=$1 where event_key like $2',['2026-10-20T16:00:00Z','%'+legacyEvent.id+'%']);
const legacyNotices=(await db.query('select id,event_key,read_at from public.app_notifications where event_key like $1 order by id',['%'+legacyEvent.id+'%'])).rows;
try{await db.exec(fs.readFileSync('supabase/migrations/20261030100000_history_notification_semantics.sql','utf8'));}
catch(error){await db.close();throw Error(error.message+' '+(error.where??''));}
const notices=async event=>(await db.query('select * from public.app_notifications where event_key like $1 order by recipient_kind',['%'+event+'%'])).rows;
const metadata=async ids=>(await db.query('select * from public.get_financial_input_event_metadata($1)',[ids])).rows;
let request=3000;
const record=async(kind,before,after,{staff=10,notify=true,id=uid(++request)}={})=>(await row('select public.record_financial_input_event($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8::jsonb,$9,$10) id',
 [uid(1),kind,date,uid(staff),JSON.stringify(before),JSON.stringify(after),'Explicit logical save',JSON.stringify([{staff_id:uid(staff),before_values:before,after_values:after}]),id,notify])).id;

test('forward migration corrects old creation notices without rewriting audit facts or read state',async()=>{
 const event=await row('select * from public.financial_input_events where id=$1',[legacyEvent.id]);
 assert.equal(event.event_action,null);assert.deepEqual(event.before_values,legacyEvent.before_values);assert.deepEqual(event.after_values,legacyEvent.after_values);assert.equal(event.note,legacyEvent.note);
 const updated=await notices(event.id);assert.equal(updated.length,2);
 for(const notice of updated){assert.equal(notice.notification_type,'ticket_recorded');assert.match(notice.title,/Ticket Created recorded/);assert.match(notice.href,new RegExp('inputEvent='+event.id));assert.ok(notice.href.endsWith('#ticket-record'));assert.equal(new Date(notice.read_at).toISOString(),'2026-10-20T16:00:00.000Z');assert.ok(legacyNotices.some(n=>n.id===notice.id&&n.event_key===notice.event_key));}
 await actor(uid(10));const own=(await metadata([event.id]))[0];assert.equal(own.event_action,'created');assert.equal(own.ticket_number,'Created');assert.equal(own.after_context.lines[0].service_name,'Manicure');assert.equal(own.after_context.tip_amount,8);
 await actor(uid(99));assert.deepEqual(await metadata([event.id]),[]);
});

test('new creation has explicit action and recorded notices; retry cannot emit another event or update notice',async()=>{
 await actor(uid(90));const payload={requestId:uid(++request),tipAmount:8};const args=[uid(1),JSON.stringify(payload),uid(++request)];
 const first=(await row('select public.submit_owner_ticket_inputs($1,$2::jsonb,$3) r',args)).r,again=(await row('select public.submit_owner_ticket_inputs($1,$2::jsonb,$3) r',args)).r;assert.equal(first.ticketId,again.ticketId);
 const event=await row('select * from public.financial_input_events where source_id=$1',[first.ticketId]);assert.equal(event.event_action,'created');
 const projection=await row('select * from public.financial_input_event_staff where event_id=$1',[event.id]);assert.equal(projection.event_action,'created');assert.equal(projection.after_values.ticket_number,'Created');assert.equal(projection.after_values.lines[0].service_name,'Manicure');
 const delivery=await notices(event.id);assert.equal(delivery.length,2);assert.ok(delivery.every(n=>n.notification_type==='ticket_recorded'));assert.ok(delivery.every(n=>!/updated|changed/i.test(n.title)));assert.match(delivery.find(n=>n.recipient_kind==='staff').body,/Service sales \$50\.00; tips \$8\.00/);
});

test('real service and tip updates explain the actual amounts, target one event, and no-op/retry stay silent',async()=>{
 await actor(uid(90));const id=uid(++request),revision=Number((await row('select workspace_revision from public.pos_tickets where id=$1',[uid(30)])).workspace_revision);
 const changed=await save({parts:[65],tip:12,id,revision});const repeated=await save({parts:[65],tip:12,id,revision});assert.equal(changed.eventId,repeated.eventId);
 const event=await row('select event_action from public.financial_input_events where id=$1',[changed.eventId]);assert.equal(event.event_action,'updated');
 const delivery=await notices(changed.eventId);assert.equal(delivery.length,2);const own=delivery.find(n=>n.recipient_kind==='staff');assert.match(own.title,/T30/);assert.match(own.body,/Service sales: \$50\.00 → \$65\.00/);assert.match(own.body,/Tips: \$10\.00 → \$12\.00/);assert.ok(own.href.includes('inputEvent='+changed.eventId));assert.ok(own.href.includes('eventDate='+past));
 const before=Number((await row('select count(*) n from public.app_notifications')).n);assert.equal((await save({parts:[65],tip:12})).unchanged,true);assert.equal(Number((await row('select count(*) n from public.app_notifications')).n),before);
});

test('discount-only edit explains the field to Staff without disclosing ticket-wide money',async()=>{
 await actor(uid(90));const changed=await save({parts:[65],updates:false,tip:12,discount:15});
 const delivery=await notices(changed.eventId),staff=delivery.find(n=>n.recipient_kind==='staff'),owner=delivery.find(n=>n.recipient_kind==='owner_manager');assert.match(staff.body,/Ticket discount changed/);assert.ok(!staff.body.includes('$15'));assert.match(owner.body,/Customer discount: \$0\.00 → \$15\.00/);
 const projection=await row('select before_values,after_values from public.financial_input_event_staff where event_id=$1',[changed.eventId]);assert.equal(projection.after_values.discount_amount,undefined);assert.ok(projection.after_values.ticket_changes.includes('discount'));assert.equal(projection.after_values.service_total,65);
});

test('reassignment projects only own removed/added work; metadata cannot return another Staff money',async()=>{
 await actor(uid(90));const changed=await save({ticket:31,item:41,staff:11,parts:[50],tip:10});
 const projections=(await db.query('select * from public.financial_input_event_staff where event_id=$1 order by staff_id',[changed.eventId])).rows;assert.equal(projections.length,2);
 assert.equal(projections[0].before_values.lines.length,1);assert.equal(projections[0].after_values.lines.length,0);assert.equal(projections[1].before_values.lines.length,0);assert.equal(projections[1].after_values.lines[0].staff_name,'Bella');assert.ok(projections.every(p=>p.after_values.ticket_changes.includes('staff_assignment')));
 assert.equal((await notices(changed.eventId)).length,3);await actor(uid(10));const own=(await metadata([changed.eventId]))[0];assert.equal(own.after_context.lines.length,0);assert.equal(own.after_context.service_total,0);assert.ok(!JSON.stringify(own).includes('Bella'));
 await actor(uid(99));assert.deepEqual(await metadata([changed.eventId]),[]);
});

test('coworker-only service edits do not create an irrelevant Staff projection or notice',async()=>{
 await actor(uid(90));const before={ticket_number:'T-own',status:'closed',service_total:100,tip_amount:0,discount_amount:0,tax_rate:0,notes:null,payments:[],
  staff_totals:{[uid(10)]:{service_total:50,tip_amount:0},[uid(11)]:{service_total:50,tip_amount:0}},lines:[{id:uid(100),staff_id:uid(10),staff_name:'Anna',service_name:'Manicure',service_total:50,parts:[50]},{id:uid(101),staff_id:uid(11),staff_name:'Bella',service_name:'Pedicure',service_total:50,parts:[50]}]};
 const after=structuredClone(before);after.lines[1].service_name='Deluxe pedicure';
 const changes=(await row('select public.pos_ticket_input_staff_changes($1::jsonb,$2::jsonb) changes',[JSON.stringify(before),JSON.stringify(after)])).changes;assert.equal(changes.length,1);assert.equal(changes[0].staff_id,uid(11));
 const event=(await row('select public.record_financial_input_event($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8::jsonb,$9,true) id',[uid(1),'ticket',date,uid(700),JSON.stringify(before),JSON.stringify(after),'Correct service name',JSON.stringify(changes),uid(++request)])).id;
 const delivery=await notices(event);assert.equal(delivery.length,2);assert.ok(!delivery.some(n=>n.recipient_user_id===uid(10)));assert.match(delivery.find(n=>n.recipient_kind==='staff').body,/Pedicure → Deluxe pedicure/);
});

test('Owner who is also Staff receives one Owner notice, while ambiguous and inactive legacy recipients are rejected',async()=>{
 await actor(uid(90));await db.query('insert into public.staff(id,salon_id,display_name,account_user_id) values($1,$2,$3,$4)',[uid(12),uid(1),'Owner technician',uid(90)]);
 const event=await record('ticket',{ticket_number:'T-self',status:'closed',service_total:5,tip_amount:0},{ticket_number:'T-self',status:'closed',service_total:10,tip_amount:0},{staff:12});const delivery=await notices(event);assert.equal(delivery.length,1);assert.equal(delivery[0].recipient_kind,'owner_manager');
 await db.query('insert into public.users(id,auth_user_id,display_name) values($1,$2,$3)',[uid(13),uid(93),'Legacy Staff']);await db.query('insert into public.staff(id,salon_id,display_name,user_id) values($1,$2,$3,$4)',[uid(13),uid(1),'Legacy Staff',uid(93)]);
 assert.equal((await row('select public.financial_input_staff_recipient($1,$2) recipient',[uid(1),uid(13)])).recipient,uid(13));
 await db.query('insert into public.staff(id,salon_id,display_name,user_id) values($1,$2,$3,$4)',[uid(14),uid(1),'Ambiguous legacy',uid(93)]);assert.equal((await row('select public.financial_input_staff_recipient($1,$2) recipient',[uid(1),uid(13)])).recipient,null);
 await db.query('update public.staff set is_active=false where id=$1',[uid(14)]);await db.query("update public.users set status='inactive' where id=$1",[uid(13)]);assert.equal((await row('select public.financial_input_staff_recipient($1,$2) recipient',[uid(1),uid(13)])).recipient,null);
});

test('settings remain opt-in, initial settings say configured, Daily Report stays silent, and bonus=0 initialization does not notify',async()=>{
 await actor(uid(90));const before=Number((await row('select count(*) n from public.app_notifications')).n);
 await record('payroll_settings',{}, {commission_rate:60,fixed_pay_amount:0},{notify:false});assert.equal(Number((await row('select count(*) n from public.app_notifications')).n),before);
 const configured=await record('payroll_settings',{}, {commission_rate:65,fixed_pay_amount:0});const settingNotice=(await notices(configured))[0];assert.equal(settingNotice.notification_type,'payroll_settings_configured');assert.equal(settingNotice.title,'Pay settings configured');assert.match(settingNotice.body,/Commission: — → 65%/);
 const daily=await record('daily_report',{}, {cash_amount:100,tip_input:20});assert.equal((await notices(daily)).length,0);
 await db.exec(`create table public.payroll_period_staff_inputs(id uuid primary key default gen_random_uuid(),salon_id uuid,staff_id uuid,period_start date,period_end date,cycle_type text,bonus_amount numeric default 0,check_number text,note text);create trigger input_audit after insert or update on public.payroll_period_staff_inputs for each row execute function public.audit_payroll_live_change();`);
 const count=Number((await row('select count(*) n from public.app_notifications')).n);await db.query('insert into public.payroll_period_staff_inputs(salon_id,staff_id,period_start,period_end,cycle_type,bonus_amount,check_number) values($1,$2,$3,$3,$4,0,$5)',[uid(1),uid(10),date,'monthly','101']);assert.equal(Number((await row('select count(*) n from public.app_notifications')).n),count);
 await db.exec('update public.payroll_period_staff_inputs set bonus_amount=25');const bonus=await row("select * from public.app_notifications where event_key like 'period-input:%' order by id desc limit 1");assert.equal(bonus.title,'Bonus updated');assert.match(bonus.body,/Bonus: \$0\.00 → \$25\.00/);assert.ok(bonus.href.includes('inputEvent='));
});
test('legacy dual-role duplicates and bonus-zero noise are hidden consistently from feed and badge, with read state preserved',async()=>{
 await actor(uid(90));const ownEvent=(await row("select event_id from public.financial_input_event_staff where staff_id=$1 order by created_at desc limit 1",[uid(12)])).event_id;
 const duplicate=uid(800),normal=uid(801),zeroAudit=uid(802),zeroNotice=uid(803),realAudit=uid(804),realNotice=uid(805);
 await db.query('insert into public.app_notifications(id,account_id,salon_id,recipient_user_id,recipient_kind,notification_type,title,body,href,event_key) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[duplicate,uid(2),uid(1),uid(90),'staff','financial_input_updated','Old duplicate','Old duplicate','/staff/my-work','financial-input:'+ownEvent+':'+uid(12)]);
 await db.query("insert into public.payroll_live_change_history(id,salon_id,staff_id,source_table,period_start,period_end,before_values,after_values) values($1,$2,$3,'payroll_period_staff_inputs',$4,$4,$5::jsonb,$6::jsonb)",[zeroAudit,uid(1),uid(90),date,'{}','{"bonus_amount":0}']);
 await db.query("insert into public.payroll_live_change_history(id,salon_id,staff_id,source_table,period_start,period_end,before_values,after_values) values($1,$2,$3,'payroll_period_staff_inputs',$4,$4,$5::jsonb,$6::jsonb)",[realAudit,uid(1),uid(90),date,'{"bonus_amount":25}','{"bonus_amount":0}']);
 for(const [id,key,title] of [[normal,'ordinary-safe-event','Ordinary reminder'],[zeroNotice,'period-input:'+zeroAudit,'Old zero initialization'],[realNotice,'period-input:'+realAudit,'Real bonus removal']])await db.query('insert into public.app_notifications(id,account_id,salon_id,recipient_user_id,recipient_kind,notification_type,title,href,event_key) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,uid(2),uid(1),uid(90),'staff','financial_input_updated',title,'/staff/my-work',key]);
 const feed=(await row('select public.notification_feed() result')).result,ids=feed.items.map(n=>n.id);assert.ok(!ids.includes(duplicate));assert.ok(!ids.includes(zeroNotice));assert.ok(ids.includes(normal));assert.ok(ids.includes(realNotice));
 const expected=Number((await row('select count(*) n from public.app_notifications n where n.recipient_user_id=$1 and n.read_at is null and n.id<>all($2)',[uid(90),[duplicate,zeroNotice]])).n);assert.equal(feed.unreadCount,expected);
 await db.query('select public.mark_all_center_notifications($1)', ['staff']);assert.equal((await row('select public.notification_feed() result')).result.unreadCount,0);
 assert.equal((await row('select read_at from public.app_notifications where id=$1',[duplicate])).read_at,null);assert.equal((await row('select read_at from public.app_notifications where id=$1',[zeroNotice])).read_at,null);
 const context=(await metadata([ownEvent]))[0];assert.ok(context.before_context);assert.equal(context.before_context.ticket_number,'T-self');
 await actor(uid(10));const staffFeed=(await row('select public.notification_feed() result')).result;assert.ok(!staffFeed.items.some(n=>n.id===normal||n.id===realNotice));
});
test('status, note, payment and same-total service splits name the actual change without duplicate or no-op notices',async()=>{
 await actor(uid(90));await sale(32,42,date);
 const current=()=>row('select workspace_revision from public.pos_tickets where id=$1',[uid(32)]);
 const mutate=async(op,values)=> (await row('select public.mutate_owner_ticket_inputs($1,$2,$3,$4,$5,$6::jsonb,$7) r',[uid(1),uid(32),Number((await current()).workspace_revision),uid(++request),op,JSON.stringify(values),'Review receipt input'])).r;
 const reopened=await mutate('reopen',{});assert.match((await notices(reopened.eventId)).find(n=>n.recipient_kind==='staff').body,/Ticket status: closed → open/);
 const changed=await mutate('notes',{notes:'Corrected receipt note'});assert.match((await notices(changed.eventId)).find(n=>n.recipient_kind==='staff').body,/Ticket note updated/);
 const count=Number((await row('select count(*) n from public.app_notifications')).n);assert.equal((await mutate('notes',{notes:'Corrected receipt note'})).unchanged,true);assert.equal(Number((await row('select count(*) n from public.app_notifications')).n),count);
 const payment=await mutate('payment_add',{payment_method:'cash',amount:60});assert.match((await notices(payment.eventId)).find(n=>n.recipient_kind==='owner_manager').body,/Ticket payments: \$0\.00 → \$60\.00/);assert.match((await notices(payment.eventId)).find(n=>n.recipient_kind==='staff').body,/Ticket payment changed/);
 const split=await mutate('item_update',{item_id:uid(42),quantity:2,unit_price:25});const splitNotice=(await notices(split.eventId)).find(n=>n.recipient_kind==='staff');assert.match(splitNotice.body,/unit price: \$50\.00 → \$25\.00/);assert.match(splitNotice.body,/quantity: 1(?:\.00)? → 2(?:\.00)?/);assert.match(splitNotice.body,/split: \$50\.00 → \$25\.00 \+ \$25\.00/);
});
test('old empty-before creation remains creation even with incomplete status, and missing own history is not invented as zero',async()=>{
 await actor(uid(90));const oldId=uid(899);
 await db.query("insert into public.financial_input_events(id,salon_id,kind,business_date,source_id,before_values,after_values,note,actor_name) values($1,$2,'ticket',$3,$4,'{}',$5::jsonb,'Original record','Owner')",[oldId,uid(1),date,uid(900),JSON.stringify({ticket_number:'T-older',service_total:50})]);
 await db.query("insert into public.financial_input_event_staff(event_id,salon_id,staff_id,staff_name,kind,business_date,before_values,after_values,note,actor_name,created_at) values($1,$2,$3,'Anna','ticket',$4,$5::jsonb,$6::jsonb,'Original record','Owner',now())",[oldId,uid(1),uid(10),date,'{"service_total":0,"tip_amount":0}','{"service_total":25,"tip_amount":5}']);
 await actor(uid(10));const own=(await metadata([oldId]))[0];assert.equal(own.event_action,'created');assert.equal(own.after_context.ticket_number,'T-older');assert.equal(own.after_context.service_total,undefined);assert.equal(own.after_context.lines,undefined);
});
test.after(async()=>await db.close());
