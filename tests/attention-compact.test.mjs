import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
const {outputFiles}=await build({entryPoints:['lib/owner-attention-presentation.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {attentionPresentation,attentionTime}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const base={item_key:'discount:1',kind:'discount',label:'Ticket T00052 discount',detail:'',business_date:'2026-10-30',occurred_at:'2026-11-01T19:37:00Z',target_href:'/pos-tickets/1',ignored:false};
const values={ticket_number:'T00052',service_total:35,discount_amount:5,tax_rate:0,tip_amount:0,lines:[{id:'1',service_name:'Nail Fill',staff_name:'Nene',service_total:35}],payments:[]};
test('created discount with draft before values stays an alert, edit focuses only changed values',()=>{
 const created=attentionPresentation({...base,facts:{eventAction:'created',actor:'Nee',source:'Owner',customerName:'Anna',before:{status:'open'},after:values}});
 assert.equal(created.title,'Discount · Ticket T52');assert.equal(created.changes.length,0);assert.equal(created.primary,'Discount: −$5.00');assert.match(created.service,/Nail Fill.*35.*Nene/);
 const edit=attentionPresentation({...base,facts:{before:values,after:{...values,discount_amount:10}}});
 assert.equal(edit.title,'Discount edited · Ticket T52');assert.deepEqual(edit.changes.map(r=>r.label),['Customer discount','Ticket total']);assert.match(edit.primary,/5.00 → \$10.00/);
 const unknown=attentionPresentation({...base,facts:{after:values}});assert.equal(unknown.customer,'Not recorded');assert.equal(unknown.source,'Unknown');
 assert.equal(attentionTime(base,'America/Chicago','2026-11-01'),'Today, 1:37 PM');
});
test('staff, notes, removed services and gift payment changes remain visible without unchanged facts',()=>{
 const after={...values,notes:'Reason',tip_amount:3,lines:[{...values.lines[0],staff_name:'Kim'}],payments:[{id:'gift',method:'gift_card',amount:10}]};
 const edit=attentionPresentation({...base,kind:'ticket_change',facts:{before:{...values,notes:''},after}});
 for(const text of ['Nene','Kim','Reason','Gift'])assert.ok(edit.changes.some(r=>JSON.stringify(r).toLowerCase().includes(text.toLowerCase())),text);
 assert.ok(!edit.changes.some(r=>r.label==='Customer discount'));
 const removed=attentionPresentation({...base,kind:'ticket_change',facts:{before:values,after:{...values,lines:[]}}});assert.ok(removed.changes.some(r=>/removed/.test(r.label)));
});
test('SQL retains event identity, captures customer once, and scopes source and review metadata',async()=>{
 const db=new PGlite(),read=p=>fs.readFileSync(p,'utf8');
 try {
 await db.exec('create role anon;create role authenticated;');
 await db.exec(read('tests/fixtures/owner-attention-schema.sql'));
 await db.exec('alter table public.financial_input_events add column request_id uuid;create table public.pos_ticket_input_requests(salon_id uuid,request_id uuid,actor_scope text,ticket_id uuid);');
 await db.exec(read('supabase/migrations/20261101070000_owner_financial_attention.sql'));
 await db.exec(read('supabase/migrations/20261101223000_attention_display_context.sql'));
 const salon='10000000-0000-4000-8000-000000000001',owner='20000000-0000-4000-8000-000000000001',customer='30000000-0000-4000-8000-000000000001',ticket='40000000-0000-4000-8000-000000000001',event='50000000-0000-4000-8000-000000000001',request='60000000-0000-4000-8000-000000000001';
 await db.query('insert into locations values($1);',[salon]);await db.query('insert into users values($1)',[owner]);await db.query("select set_config('test.user_id',$1,false)",[owner]);
 await db.query('insert into customers values($1,$2,$3)',[customer,salon,'Anna']);
 await db.query("insert into pos_tickets(id,salon_id,customer_id,ticket_number,opened_at,status,facts) values($1,$2,$3,'T00052',now(),'closed',$4)",[ticket,salon,customer,values]);
 await db.query("insert into financial_input_events(id,salon_id,kind,business_date,source_id,before_values,after_values,note,actor_name,created_at,event_action,request_id) values($1,$2,'ticket','2026-11-01',$3,'{}',$4,'Ticket created','Nee',clock_timestamp(),'created',$5)",[event,salon,ticket,values,request]);
 await db.query('insert into pos_ticket_input_requests values($1,$2,$3,$4)',[salon,request,'owner:'+owner,ticket]);
 await db.query("update customers set name='Renamed' where id=$1",[customer]);
 let data=(await db.query('select owner_financial_attention($1) data',[salon])).rows[0].data;
 assert.equal(data.items.length,1);assert.equal(data.items[0].facts.customerName,'Anna');assert.equal(data.items[0].facts.source,'Owner');assert.equal(data.items[0].facts.createdBy,'Nee');
 const edit='50000000-0000-4000-8000-000000000002';
 await db.query("insert into financial_input_events(id,salon_id,kind,business_date,source_id,before_values,after_values,note,actor_name,created_at,event_action) values($1,$2,'ticket','2026-11-01',$3,$4,$5,'Reason','Kim',clock_timestamp(),'updated')",[edit,salon,ticket,values,{...values,discount_amount:10}]);
 data=(await db.query('select owner_financial_attention($1) data',[salon])).rows[0].data;assert.equal(data.items.length,2);assert.equal(new Set(data.items.map(r=>r.item_key)).size,2);
 const changed=data.items.find(r=>r.item_key==='discount:'+edit);assert.equal(changed.facts.eventAction,'updated');assert.equal(changed.facts.source,'Unknown');assert.equal(changed.facts.createdBy,'Nee');
 await db.query("select owner_financial_attention_action($1,$2,'ignore')",[salon,changed.item_key]);data=(await db.query('select owner_financial_attention($1) data',[salon])).rows[0].data;assert.equal(data.items.length,1);
 assert.equal((await db.query('select count(*)::int n from financial_input_events')).rows[0].n,2);
 assert.deepEqual((await db.query('select facts from pos_tickets where id=$1',[ticket])).rows[0].facts,values);
 // Creation source is captured from the trusted backend call, never actor name or UA.
 await db.exec(`create function public.submit_owner_workspace_receipt_core() returns void language plpgsql as $$begin insert into financial_input_events(id,salon_id,kind,business_date,source_id,before_values,after_values,actor_name,created_at,event_action) values('50000000-0000-4000-8000-000000000003','${salon}','ticket','2026-11-01','${ticket}','{}','{}','Nee',clock_timestamp(),'draft');end;$$;select public.submit_owner_workspace_receipt_core();`);
 assert.equal((await db.query("select attention_context->>'source' source from financial_input_events where id='50000000-0000-4000-8000-000000000003'")).rows[0].source,'Owner');
 } finally { await db.close(); }
});
