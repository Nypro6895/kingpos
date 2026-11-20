import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {historyNotificationFixture} from './helpers/history-notification-fixture.mjs';

// Exercise the installed Owner ticket commands, revision/request receipts,
// captured snapshots and notification feed together. No hosted data is used.
const {db,row,actor,uid}=await historyNotificationFixture();
let request=8000;
await actor(uid(90));
const create=async()=> (await row('select public.create_owner_open_ticket($1,null,null,null,$2) r',[uid(1),uid(++request)])).r;
const mutate=async(ticket,operation,values={},id=uid(++request),expected)=>{
 const revision=expected??Number((await row('select workspace_revision from public.pos_tickets where id=$1',[ticket])).workspace_revision);
 return (await row('select public.mutate_owner_ticket_inputs($1,$2,$3,$4,$5,$6::jsonb,$7) r',[
  uid(1),ticket,revision,id,operation,JSON.stringify(values),'Review ticket input',
 ])).r;
};
const item=async ticket=>(await row('select id from public.pos_ticket_items where pos_ticket_id=$1 and not coalesce(is_removed,false)',[ticket])).id;
const events=async ticket=>(await db.query('select * from public.financial_input_events where source_id=$1 order by created_at,id',[ticket])).rows;
const notices=async ticket=>(await db.query('select n.* from public.app_notifications n join public.financial_input_events e on n.event_key like $1||e.id::text||$2 where e.source_id=$3 order by n.id',['%','%',ticket])).rows;
const feed=async()=> (await row("select public.notification_feed('staff',null,null,false,null,null,51) value")).value;

// Retain a genuine pre-migration draft trail. The migration must classify these
// old events on read and preserve their immutable facts and viewed state.
const legacy=(await create()).ticketId;
await mutate(legacy,'item_add',{service_id:uid(20)});
await mutate(legacy,'item_staff',{item_id:await item(legacy),assigned_staff_id:uid(10)});
const priorEvents=await events(legacy),priorNotices=await notices(legacy);
await db.query('update public.app_notifications set read_at=$1 where id=any($2)', ['2026-10-20T16:00:00Z',priorNotices.map(n=>n.id)]);
try{await db.exec(fs.readFileSync('supabase/migrations/20261030100000_history_notification_semantics.sql','utf8'));}
catch(error){await db.close();throw Error(error.message+' '+(error.where??''));}

test('retained initial draft events and notices are classified without rewriting facts or read state',async()=>{
 await actor(uid(90));
 const actions=(await db.query('select * from public.get_financial_input_event_metadata($1)',[priorEvents.map(e=>e.id)])).rows;
 assert.equal(actions.length,priorEvents.length);assert.ok(actions.every(e=>e.event_action==='draft'));
 const after=await events(legacy);assert.deepEqual(after.map(e=>[e.id,e.before_values,e.after_values]),priorEvents.map(e=>[e.id,e.before_values,e.after_values]));
 const retained=await notices(legacy);assert.equal(retained.length,priorNotices.length);assert.ok(retained.every(n=>new Date(n.read_at).toISOString()==='2026-10-20T16:00:00.000Z'));
 for(const viewer of [90,10]){
  await actor(uid(viewer));const page=await feed();assert.ok(page.items.every(n=>!retained.some(old=>old.id===n.id)));
 }
});

let completed;
test('constructing a new Owner draft stays silent; first checkout records one full submitted entry',async()=>{
 await actor(uid(90));const ticket=(await create()).ticketId;
 await mutate(ticket,'item_add',{service_id:uid(20)});const line=await item(ticket);
 await mutate(ticket,'item_staff',{item_id:line,assigned_staff_id:uid(10)});
 await mutate(ticket,'tip',{tip_type:'fixed_amount',tip_value:10});
 await mutate(ticket,'payment_add',{payment_method:'cash',amount:60});
 const drafts=await events(ticket);assert.ok(drafts.length>0);assert.ok(drafts.every(e=>e.event_action==='draft'));assert.deepEqual(await notices(ticket),[]);
 const id=uid(++request),revision=Number((await row('select workspace_revision from public.pos_tickets where id=$1',[ticket])).workspace_revision);
 const first=await mutate(ticket,'checkout',{},id,revision),replayed=await mutate(ticket,'checkout',{},id,revision);
 assert.equal(first.eventId,replayed.eventId);assert.equal(replayed.replayed,true);
 const saved=(await events(ticket)).find(e=>e.id===first.eventId);assert.equal(saved.event_action,'created');assert.equal(saved.after_values.status,'closed');assert.equal(saved.after_values.service_total,50);assert.equal(saved.after_values.tip_amount,10);assert.equal(saved.after_values.lines.length,1);assert.equal(saved.after_values.staff_totals[uid(10)].tip_amount,10);
 const delivery=await notices(ticket);assert.equal(delivery.length,2);assert.deepEqual(new Set(delivery.map(n=>n.recipient_kind)),new Set(['owner_manager','staff']));assert.ok(delivery.every(n=>n.notification_type==='ticket_recorded'&&n.href.endsWith('#ticket-record')&&n.href.includes('inputEvent='+first.eventId)));assert.ok(delivery.every(n=>!/(changed|updated)/i.test(n.title)));
 completed={ticket,line};
});

test('reopening, editing and checking out a previously submitted ticket remain real updates',async()=>{
 assert.ok(completed);await actor(uid(90));const {ticket,line}=completed;
 const reopened=await mutate(ticket,'reopen');const edited=await mutate(ticket,'item_update',{item_id:line,quantity:1,unit_price:55});
 const payment=(await row('select id from public.pos_payments where ticket_id=$1',[ticket])).id;
 await mutate(ticket,'payment_remove',{payment_id:payment});await mutate(ticket,'payment_add',{payment_method:'cash',amount:65});
 const checked=await mutate(ticket,'checkout');
 const saved=await events(ticket);for(const id of [reopened.eventId,edited.eventId,checked.eventId])assert.equal(saved.find(e=>e.id===id).event_action,'updated');
 assert.equal(saved.filter(e=>e.event_action==='created').length,1);
 const delivery=await notices(ticket);for(const id of [reopened.eventId,edited.eventId,checked.eventId]){
  const specific=delivery.filter(n=>n.href.includes('inputEvent='+id));assert.equal(specific.length,2);assert.ok(specific.every(n=>n.notification_type==='financial_input_updated'&&n.href.endsWith('#input-history')));
 }
});

test('a draft no-op is silent and ambiguous legacy open tickets are never guessed to be a first submission',async()=>{
 await actor(uid(90));const ticket=(await create()).ticketId;
 await mutate(ticket,'item_add',{service_id:uid(20)});const line=await item(ticket),before=(await events(ticket)).length;
 const unchanged=await mutate(ticket,'item_update',{item_id:line,quantity:1,unit_price:50});assert.equal(unchanged.unchanged,true);assert.equal((await events(ticket)).length,before);assert.deepEqual(await notices(ticket),[]);
 const old={status:'open',service_total:50,tip_amount:0},next={...old,service_total:55};
 const classification=await row('select public.classify_financial_input_event($1,$2,$3,$4::jsonb,$5::jsonb,clock_timestamp(),null) action',[
  uid(1),'ticket',uid(9999),JSON.stringify(old),JSON.stringify(next),
 ]);assert.equal(classification.action,'updated');
});

test('the canonical Owner notice controls the badge even when the legacy Staff duplicate has a different read state',async()=>{
 await actor(uid(90));const before=(await feed()).unreadCount;
 await db.query('insert into public.staff(id,salon_id,display_name,account_user_id) values($1,$2,$3,$4)',[uid(12),uid(1),'Owner technician',uid(90)]);
 const old={ticket_number:'T-dual',status:'closed',service_total:5,tip_amount:0},next={...old,service_total:10};
 const event=(await row('select public.record_financial_input_event($1,$2,current_date,$3,$4::jsonb,$5::jsonb,$6,$7::jsonb,$8,true) id',[
  uid(1),'ticket',uid(9000),JSON.stringify(old),JSON.stringify(next),'Review submitted service',
  JSON.stringify([{staff_id:uid(12),before_values:old,after_values:next}]),uid(++request),
 ])).id;
 const canonical=await row('select id from public.app_notifications where event_key=$1',['financial-input-owner:'+event+':'+uid(90)]);
 const duplicate=uid(++request);
 await db.query('insert into public.app_notifications(id,salon_id,recipient_user_id,recipient_kind,notification_type,title,href,event_key) values($1,$2,$3,$4,$5,$6,$7,$8)',[
  duplicate,uid(1),uid(90),'staff','financial_input_updated','Retained duplicate','/staff/my-work','financial-input:'+event+':'+uid(12),
 ]);
 await db.query('update public.app_notifications set read_at=$1 where id=$2',['2026-10-20T16:00:00Z',canonical.id]);
 for(const kind of ['customer','staff','owner_manager']){
  const page=(await row('select public.notification_feed($1,$2,$3) value',[kind,uid(999),uid(998)])).value;
  assert.equal(page.unreadCount,before);assert.ok(!page.items.some(n=>n.id===duplicate));
 }
 await db.query('update public.app_notifications set read_at=null where id=$1',[canonical.id]);
 await db.query('update public.app_notifications set read_at=$1 where id=$2',['2026-10-21T16:00:00Z',duplicate]);
 const page=await feed();assert.equal(page.unreadCount,before+1);assert.ok(page.items.some(n=>n.id===canonical.id));assert.ok(!page.items.some(n=>n.id===duplicate));
 assert.equal(new Date((await row('select read_at from public.app_notifications where id=$1',[duplicate])).read_at).toISOString(),'2026-10-21T16:00:00.000Z');
 assert.equal((await row('select read_at from public.app_notifications where id=$1',[canonical.id])).read_at,null);
});

test.after(async()=>await db.close());
