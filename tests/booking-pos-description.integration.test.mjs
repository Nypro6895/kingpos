import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

test('booking conversion fails atomically before the missing-column fix and preserves snapshots/idempotency after it',{
  skip:process.env.RUN_ISOLATED_SUPABASE!=='1',timeout:900000,
},async t=>{
  const f=await startIsolatedSupabase('iphone-booking-pos',JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{}'));t.after(()=>f.close());
  // The column regression temporarily replays an older migration. Restore the
  // fully migrated command afterward so the successful calls exercise today's
  // booking authority/locking wrapper, including Staff-day serialization.
  const finalConversion=f.sql("select pg_get_functiondef('public.convert_booking_to_pos_ticket(uuid)'::regprocedure)");
  assert.ok(finalConversion.includes('booking-pos-authority-v1'),'full migration chain must enforce booking.manage in SQL');
  assert.ok(finalConversion.includes('staff-day-input:'),'full migration chain must preserve current Staff-day serialization');
  const owner=f.person('qa-owner'),outsider=f.person('qa-outsider');
  const account=f.rpc(owner,'ensure_personal_account_for_current_user',{p_account_name:'Physical QA fixture'})[0].account_id;
  const salon=f.rpc(owner,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:crypto.randomUUID(),p_name:'Isolated iPhone QA',p_owner_is_staff:false,
    p_phone:null,p_address_line1:null,p_address_line2:null,p_city:null,p_state:null,p_postal_code:null,p_country:'US'}).salon_id;
  const booking=crypto.randomUUID(),customer=crypto.randomUUID();
  f.sql(`alter table bookings disable trigger enforce_booking_time_policy;
    insert into customers(id,location_id,name) values('${customer}','${salon}','Isolated QA customer');
    insert into bookings(id,salon_id,customer_id,start_at,end_at,status) values('${booking}','${salon}','${customer}',now()+interval '2 days',now()+interval '2 days 30 minutes','confirmed');
    insert into booking_lines(salon_id,booking_id,service_name_snapshot,service_category_snapshot,service_description_snapshot,quantity,unit_price,line_total,line_status)
    values('${salon}','${booking}','Booked manicure','Nails','Description fixed at booking',2,12.50,25,'scheduled'),('${salon}','${booking}','Cancelled line','Nails','Ignore',1,99,99,'cancelled');
    alter table pos_ticket_items drop column service_description_snapshot;`);
  assert.throws(()=>f.rpc(owner,'convert_booking_to_pos_ticket',{p_booking_id:booking}),/service_description_snapshot/);
  assert.equal(f.sql(`select count(*) from pos_tickets where source_booking_id='${booking}'`),'0','SQL error must roll back the ticket too');
  assert.equal(f.sql(`select pos_ticket_id is null from bookings where id='${booking}'`),'t','failed conversion must not bind the booking');
  f.sql(fs.readFileSync('supabase/migrations/20261028003000_booking_pos_description_snapshot.sql','utf8'));
  f.sql(finalConversion);
  assert.equal(f.sql("select pg_get_functiondef('public.convert_booking_to_pos_ticket(uuid)'::regprocedure)"),finalConversion,'successful calls must test the final installed wrapper, not only the old column fix');
  const ticket=f.rpc(owner,'convert_booking_to_pos_ticket',{p_booking_id:booking});
  assert.match(ticket,/^[a-f0-9-]{36}$/);
  assert.equal(f.rpc(owner,'convert_booking_to_pos_ticket',{p_booking_id:booking}),ticket);
  const rows=f.rest(owner,`/pos_ticket_items?pos_ticket_id=eq.${ticket}`);
  assert.equal(rows.length,1);assert.equal(rows[0].service_description_snapshot,'Description fixed at booking');
  assert.equal(Number(rows[0].booked_unit_price_snapshot),12.5);assert.equal(Number(rows[0].quantity),2);assert.equal(Number(rows[0].line_total),25);
  assert.equal(f.sql(`select count(*) from pos_tickets where source_booking_id='${booking}'`),'1');
  assert.throws(()=>f.rpc(outsider,'convert_booking_to_pos_ticket',{p_booking_id:booking}));
  f.save('booking-pos-description-result.json',{booking,ticket,rows:1,total:25,descriptionPreserved:true,idempotent:true,outsiderDenied:true,missingColumnRolledBackBookingBinding:true,finalWrapperRestored:true,staffDaySerializationPresent:true,finalWrapperSha256:crypto.createHash('sha256').update(finalConversion).digest('hex')});
  // Real Postgres, isolated data only. Keep today's result at 30 tickets while
  // growing historical data 1,000x; distinguish SQL work from HTTP/auth latency.
  f.sql(`create table public.qa_scale_tickets (like public.pos_tickets including defaults including indexes);`);
  const scale=[];
  for (const total of [30,3000,30000]) {
    f.sql(`truncate public.qa_scale_tickets;
      insert into public.qa_scale_tickets(id,salon_id,status,opened_at)
      select gen_random_uuid(),'${salon}','closed',case when n<=30 then '2026-10-27 12:00:00+00'::timestamptz else '2026-10-01 12:00:00+00'::timestamptz end + n*interval '1 millisecond'
      from generate_series(1,${total}) n;
      analyze public.qa_scale_tickets;`);
    const select=`select id,opened_at,closed_at,status,discount_type,discount_value,tax_rate,tip_type,tip_value from public.qa_scale_tickets where salon_id='${salon}'`;
    const ranged=select+` and opened_at >= '2026-10-27' and opened_at < '2026-10-28' order by opened_at`;
    const samples=[];
    for(let round=0;round<5;round++)samples.push(f.json(`explain(analyze,buffers,format json) ${ranged}`)[0]);
    const payload=f.json(`select json_build_object('returned',count(*),'bytes',octet_length(json_agg(t)::text)) from (${ranged}) t`);
    const full=f.json(`select json_build_object('returned',count(*),'bytes',octet_length(json_agg(t)::text)) from (${select}) t`);
    scale.push({historicalPlusCurrentTickets:total,currentDay:payload,unboundedHistory:full,executionMs:samples.map(p=>p['Execution Time']),plans:samples});
  }
  assert.ok(scale.every(row=>row.currentDay.returned===30));
  f.save('indexed-read-scale.json',{environment:'isolated PostgreSQL 17; full migrated schema index definitions; no iPhone/network/auth included',scale});
});
