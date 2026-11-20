import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {historyNotificationFixture} from './helpers/history-notification-fixture.mjs';

const {db,row,actor,uid,date,save}=await historyNotificationFixture();
let request=20000;
await actor(uid(90));
const create=async()=> (await row('select public.create_owner_open_ticket($1,null,null,null,$2) r',[uid(1),uid(++request)])).r.ticketId;
const mutate=async(ticket,operation,values={},id=uid(++request),expected)=>{
 const revision=expected??Number((await row('select workspace_revision from public.pos_tickets where id=$1',[ticket])).workspace_revision);
 return (await row('select public.mutate_owner_ticket_inputs($1,$2,$3,$4,$5,$6::jsonb,$7) r',[
  uid(1),ticket,revision,id,operation,JSON.stringify(values),'Review captured ticket input',
 ])).r;
};
const item=async ticket=>(await row('select id from public.pos_ticket_items where pos_ticket_id=$1 and not coalesce(is_removed,false)',[ticket])).id;
const adjustments=async ticket=>(await db.query('select * from public.pos_ticket_adjustments where ticket_id=$1 order by created_at,id',[ticket])).rows;
const metadata=async ids=>(await db.query('select * from public.get_pos_ticket_adjustment_metadata($1)',[ids])).rows;
const portable=async()=> (await row('select public.get_pos_portable_ticket_data($1,$2,$3) r',[uid(80),'valid',date])).r;

// Genuine earlier writer: immutable raw snapshots are retained, including the
// payment operation whose raw before/after snapshot has no payment fields.
const legacy=await create();
await mutate(legacy,'item_add',{service_id:uid(20)});
await mutate(legacy,'item_staff',{item_id:await item(legacy),assigned_staff_id:uid(10)});
await mutate(legacy,'payment_add',{payment_method:'cash',amount:50});
await mutate(legacy,'checkout');
await mutate(legacy,'reopen');
await mutate(legacy,'item_update',{item_id:await item(legacy),quantity:1,unit_price:55});
const oldRows=await adjustments(legacy);
await db.exec(fs.readFileSync('supabase/migrations/20261030100000_history_notification_semantics.sql','utf8'));

test('legacy raw cards classify initial construction and first checkout without rewriting captured facts',async()=>{
 await actor(uid(90));
 const current=await adjustments(legacy);assert.deepEqual(current.map(({financial_input_event_id,...facts})=>{assert.equal(financial_input_event_id,null);return facts;}),oldRows);
 const actions=new Map((await metadata(current.map(a=>a.id))).map(a=>[a.adjustment_id,a.event_action]));
 for(const a of current){
  const before=a.before_snapshot.ticket.status,after=a.after_snapshot.ticket.status;
  const expected=before==='closed'?'updated':after==='closed'?'created':a===current.at(-1)?'updated':'draft';
  assert.equal(actions.get(a.id),expected);
 }
 const signed=(await portable()).tickets.find(t=>t.id===legacy);assert.ok(signed);
 assert.deepEqual(new Map(signed.adjustments.map(a=>[a.id,a.eventAction])),actions);
 assert.equal((await row('select public.get_pos_portable_ticket_data($1,$2,$3) r',[uid(80),'invalid',date])).r,null);
});

test('new raw operations link the exact logical event for draft, creation and subsequent updates, including retry and no-op',async()=>{
 await actor(uid(90));const ticket=await create();
 await mutate(ticket,'item_add',{service_id:uid(20)});const line=await item(ticket);
 await mutate(ticket,'item_staff',{item_id:line,assigned_staff_id:uid(10)});
 await mutate(ticket,'payment_add',{payment_method:'cash',amount:50});
 const id=uid(++request),revision=Number((await row('select workspace_revision from public.pos_tickets where id=$1',[ticket])).workspace_revision);
 const checked=await mutate(ticket,'checkout',{},id,revision),retry=await mutate(ticket,'checkout',{},id,revision);assert.equal(checked.eventId,retry.eventId);assert.equal(retry.replayed,true);
 await mutate(ticket,'reopen');await mutate(ticket,'item_update',{item_id:line,quantity:1,unit_price:55});
 const rows=await adjustments(ticket);assert.equal(rows.length,6);assert.ok(rows.every(a=>a.financial_input_event_id));
 const linked=(await db.query('select a.id,e.id event_id,e.source_id,e.salon_id,e.event_action from public.pos_ticket_adjustments a join public.financial_input_events e on e.id=a.financial_input_event_id where a.ticket_id=$1 order by e.created_at,e.id',[ticket])).rows;
 assert.deepEqual(linked.map(a=>a.event_action),['draft','draft','draft','created','updated','updated']);
 assert.ok(linked.every(a=>a.source_id===ticket&&a.salon_id===uid(1)));
 const classified=new Map((await metadata(rows.map(a=>a.id))).map(a=>[a.adjustment_id,a.event_action]));for(const a of linked)assert.equal(classified.get(a.id),a.event_action);
 const unchanged=await mutate(ticket,'item_update',{item_id:line,quantity:1,unit_price:55});assert.equal(unchanged.unchanged,true);assert.equal((await adjustments(ticket)).length,6);
 const signed=(await portable()).tickets.find(t=>t.id===ticket);for(const a of signed.adjustments)assert.equal(a.eventAction,classified.get(a.id));
 const correction=await save({parts:[60],tip:12});const raw=await row('select * from public.pos_ticket_adjustments where financial_input_event_id=$1',[correction.eventId]);assert.ok(raw);assert.equal(raw.ticket_id,uid(30));assert.equal((await metadata([raw.id]))[0].event_action,'updated');
});

test('metadata is bounded and available only to the salon Owner or admitted nonStaff Manager',async()=>{
 const ids=oldRows.map(a=>a.id);
 await actor(uid(10));assert.deepEqual(await metadata(ids),[]);
 await actor(uid(999));assert.deepEqual(await metadata(ids),[]);
 await actor(uid(91));assert.deepEqual(await metadata(ids),[]);
 await db.query('insert into public.roles values($1,$2)',[uid(25),'MANAGER']);
 await db.query('insert into public.salon_memberships values($1,$2,$3,$4)',[uid(1),uid(91),uid(25),'active']);
 assert.equal((await metadata(ids)).length,ids.length);
 await assert.rejects(metadata(Array(501).fill(ids[0])),/up to 500/);
 await actor(null);await assert.rejects(metadata(ids),/Sign in required/);
 assert.equal((await row("select has_function_privilege('authenticated','public.classify_pos_ticket_adjustment(public.pos_ticket_adjustments)','EXECUTE') allowed")).allowed,false);
 assert.equal((await row("select has_function_privilege('anon','public.get_pos_ticket_adjustment_metadata(uuid[])','EXECUTE') allowed")).allowed,false);
});

test('missing legacy lifecycle stays visible; a captured prior version proves completion after a transaction start',async()=>{
 await actor(uid(90));
 const sparse=uid(++request);await db.query("insert into public.pos_ticket_adjustments(id,salon_id,ticket_id,action,reason,before_snapshot,after_snapshot) values($1,$2,$3,'item_corrected','Unknown old receipt','{}','{}')",[sparse,uid(1),uid(31)]);
 assert.equal((await metadata([sparse]))[0].event_action,'updated');
 // This models a transaction started before another completed writer released
 // its lock. No nearest-time association or current ticket lookup is needed.
 const target=uid(31),initial=uid(++request),closed=uid(++request),raw=uid(++request);
 await db.query("insert into public.financial_input_events(id,salon_id,kind,business_date,source_id,before_values,after_values,note,actor_name,created_at) values($1,$2,'ticket',$3,$4,'{}','{\"status\":\"open\"}','Captured initial','Owner','2026-01-01T10:00Z'),($5,$2,'ticket',$3,$4,'{\"status\":\"open\"}','{\"status\":\"closed\"}','Completed','Owner','2026-01-01T12:00Z')",[initial,uid(1),date,target,closed]);
 await db.query("insert into public.pos_ticket_adjustments(id,salon_id,ticket_id,action,reason,before_snapshot,after_snapshot,created_at) values($1,$2,$3,'item_corrected','Later reopened edit',$4,$5,'2026-01-01T11:00Z')",[raw,uid(1),target,{ticket:{status:'open',updated_at:'2026-01-01T12:01Z'}},{ticket:{status:'open'}}]);
 assert.equal((await metadata([raw]))[0].event_action,'updated');
 const retained=await row('select before_snapshot,after_snapshot,financial_input_event_id from public.pos_ticket_adjustments where id=$1',[raw]);assert.equal(retained.financial_input_event_id,null);assert.equal(retained.before_snapshot.ticket.updated_at,'2026-01-01T12:01Z');
});

test.after(async()=>await db.close());
