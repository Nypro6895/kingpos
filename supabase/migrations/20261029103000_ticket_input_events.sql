begin;

-- Source inputs may change after payment; published payroll/payment rows do not.
create table public.pos_ticket_input_requests (
 salon_id uuid not null references public.locations(id) on delete cascade,
 request_id uuid not null, actor_scope text not null, ticket_id uuid not null,
 fingerprint text not null, result jsonb not null, created_at timestamptz not null default clock_timestamp(),
 primary key(salon_id,request_id)
);
alter table public.pos_ticket_input_requests enable row level security;
revoke all on public.pos_ticket_input_requests from public,anon,authenticated,service_role;
create table public.pos_ticket_input_creations (
 ticket_id uuid primary key references public.pos_tickets(id) on delete cascade,
 event_id uuid not null, created_at timestamptz not null default clock_timestamp()
);
alter table public.pos_ticket_input_creations enable row level security;
revoke all on public.pos_ticket_input_creations from public,anon,authenticated,service_role;

-- Only business values are compared: recalculation timestamps and generated part
-- IDs cannot turn a no-op into another financial adjustment.
create function public.pos_ticket_input_snapshot(p_salon uuid,p_ticket uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
 with line_rows as (
  select i.id,i.assigned_staff_id,i.service_id,
   coalesce(i.service_name_snapshot,s.name,case when i.service_id is null then 'Custom service' else 'Service' end) as service_name,
   coalesce(st.display_name,'Staff') as staff_name,
   round(i.line_total,2) as amount,i.quantity,i.unit_price,i.notes,
   coalesce((select jsonb_agg(round(p.amount,2) order by p.turn_index,p.created_at,p.id)
     from public.pos_ticket_item_turn_parts p where p.salon_id=p_salon and p.ticket_item_id=i.id),jsonb_build_array(round(i.line_total,2))) as parts
  from public.pos_ticket_items i left join public.services s on s.id=i.service_id
   left join public.staff st on st.id=i.assigned_staff_id
  where i.salon_id=p_salon and i.pos_ticket_id=p_ticket and not coalesce(i.is_removed,false)
 ), totals as (select coalesce(sum(amount),0) as gross from line_rows),
 staff_rows as (
  select l.assigned_staff_id as staff_id,round(sum(l.amount),2) as service_total,
   coalesce((select round(e.tip_amount,2) from public.pos_ticket_staff_earnings e
     where e.salon_id=p_salon and e.ticket_id=p_ticket and e.staff_id=l.assigned_staff_id),0) as tip_amount
  from line_rows l where l.assigned_staff_id is not null group by l.assigned_staff_id
 )
 select jsonb_build_object('ticket_number',t.ticket_number,'status',t.status,'notes',t.notes,'tax_rate',t.tax_rate,'service_total',totals.gross,
  'tip_amount',case when t.tip_type='percentage' then coalesce((select sum(e.tip_amount) from public.pos_ticket_staff_earnings e where e.salon_id=p_salon and e.ticket_id=p_ticket),
    round((totals.gross-least(totals.gross,case when t.discount_type='percentage' then round(totals.gross*t.discount_value/100,2) else t.discount_value end))*(1+t.tax_rate/100)*greatest(t.tip_value,0)/100,2)) else round(greatest(t.tip_value,0),2) end,
  'discount_type',t.discount_type,'discount_value',round(t.discount_value,2),
  'discount_amount',least(totals.gross,case when t.discount_type='percentage' then round(totals.gross*t.discount_value/100,2) else round(t.discount_value,2) end),
  'lines',coalesce((select jsonb_agg(jsonb_build_object('id',id,'staff_id',assigned_staff_id,'staff_name',staff_name,
    'service_id',service_id,'service_name',service_name,'service_total',amount,'quantity',quantity,'unit_price',unit_price,'notes',notes,'parts',parts) order by id) from line_rows),'[]'::jsonb),
  'staff_totals',coalesce((select jsonb_object_agg(staff_id::text,jsonb_build_object('service_total',service_total,'tip_amount',tip_amount)) from staff_rows),'{}'::jsonb),
  'recorded_payment_total',(select coalesce(sum(p.amount),0) from public.pos_payments p where p.salon_id=p_salon and p.ticket_id=p_ticket),
  'payments',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'method',p.payment_method,'amount',p.amount,'note',p.note) order by p.id) from public.pos_payments p where p.salon_id=p_salon and p.ticket_id=p_ticket),'[]'::jsonb))
 from public.pos_tickets t cross join totals where t.id=p_ticket and t.salon_id=p_salon;
$$;
revoke all on function public.pos_ticket_input_snapshot(uuid,uuid) from public,anon,authenticated,service_role;

create function public.pos_ticket_input_staff_changes(p_before jsonb,p_after jsonb)
returns jsonb language sql immutable set search_path=pg_catalog,public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('staff_id',s.id,'before_values',coalesce(p_before->'staff_totals'->s.id,jsonb_build_object('service_total',0,'tip_amount',0))||jsonb_build_object('status',p_before->'status'),
  'after_values',coalesce(p_after->'staff_totals'->s.id,jsonb_build_object('service_total',0,'tip_amount',0))||jsonb_build_object('status',p_after->'status')) order by s.id),'[]'::jsonb)
 from (select jsonb_object_keys(coalesce(p_before->'staff_totals','{}'::jsonb)) as id
   union select jsonb_object_keys(coalesce(p_after->'staff_totals','{}'::jsonb))) s;
$$;
revoke all on function public.pos_ticket_input_staff_changes(jsonb,jsonb) from public,anon,authenticated,service_role;

-- Preserve the installed turn/tip allocation engine, but retain the identity and
-- payroll binding of source rows. Payments and published payroll remain immutable.
do $patch$
declare d text; a integer; b integer;
begin
 d:=replace(pg_get_functiondef('public.recalculate_pos_ticket_staff_earnings_for_date(uuid,date)'::regprocedure),E'\r\n',E'\n');
 d:=replace(d,'recalculate_pos_ticket_staff_earnings_for_date(', 'recalculate_pos_ticket_input_earnings_for_date(');
 d:=replace(d,'p_work_date date)', 'p_work_date date, p_changed_ticket uuid DEFAULT NULL::uuid)');
 if position('p_changed_ticket uuid' in d)=0 then raise exception 'Review target-aware source earning signature';end if;
 a:=position('  if exists (' in d); b:=position('  target_timezone :=' in d);
 if a=0 or b<=a then raise exception 'Review source earning lock guard before ticket input migration';end if;
 d:=overlay(d placing '' from a for b-a);
 a:=position('  delete from public.pos_ticket_staff_earnings earnings' in d);
 b:=position('  with ticket_scope as (' in d);
 if a=0 or b<=a then raise exception 'Review source earning replacement before ticket input migration';end if;
 d:=overlay(d placing '' from a for b-a);
 d:=replace(d,'    from final_rows'||chr(10)||'    returning 1',
  '    from final_rows
    where final_rows.ticket_id=p_changed_ticket or exists (
      select 1 from public.pos_ticket_staff_earnings existing where existing.ticket_id=final_rows.ticket_id and existing.staff_id=final_rows.staff_id)
    on conflict (ticket_id,staff_id) do update set
      service_total=case when excluded.ticket_id=p_changed_ticket then excluded.service_total else pos_ticket_staff_earnings.service_total end,
      tip_amount=case when excluded.ticket_id=p_changed_ticket then excluded.tip_amount else pos_ticket_staff_earnings.tip_amount end,
      tip_is_manual=case when excluded.ticket_id=p_changed_ticket then excluded.tip_is_manual else pos_ticket_staff_earnings.tip_is_manual end,
      manual_tip_amount=case when excluded.ticket_id=p_changed_ticket then excluded.manual_tip_amount else pos_ticket_staff_earnings.manual_tip_amount end,
      big_turn_count=excluded.big_turn_count,small_turn_count=excluded.small_turn_count,
      first_big_turn_sequence=excluded.first_big_turn_sequence,last_big_turn_sequence=excluded.last_big_turn_sequence,
      first_small_turn_sequence=excluded.first_small_turn_sequence,last_small_turn_sequence=excluded.last_small_turn_sequence,
      total_earning=case when excluded.ticket_id=p_changed_ticket then excluded.total_earning else pos_ticket_staff_earnings.total_earning end,
      calculation_version=excluded.calculation_version'||chr(10)||'    returning 1');
 if position('on conflict (ticket_id,staff_id) do update set' in d)=0 then raise exception 'Review source earning upsert';end if;
 d:=replace(d,'  return inserted_count;',
  '  update public.pos_ticket_staff_earnings e set service_total=0,tip_amount=0,manual_tip_amount=null,tip_is_manual=false,
    big_turn_count=0,small_turn_count=0,first_big_turn_sequence=null,last_big_turn_sequence=null,
    first_small_turn_sequence=null,last_small_turn_sequence=null,total_earning=0
   where e.salon_id=p_salon_id and e.work_date=p_work_date and e.ticket_id=p_changed_ticket and not exists (
    select 1 from public.pos_tickets t join public.pos_ticket_items i on i.pos_ticket_id=t.id and i.salon_id=t.salon_id
    where t.id=e.ticket_id and t.salon_id=e.salon_id and t.status=''closed'' and not coalesce(i.is_removed,false)
      and i.assigned_staff_id=e.staff_id);
  return inserted_count;');
 -- Fixed tips survive full discounts. Legacy percentages retain their installed
 -- after-discount/tax basis until an explicit input save freezes the resolved tip.
 d:=replace(d,'when round(ticket_tax.taxable_amount + ticket_tax.tax_amount, 2) <= 0', 'when false');
 execute d;
end;$patch$;
revoke all on function public.recalculate_pos_ticket_input_earnings_for_date(uuid,date,uuid) from public,anon,authenticated,service_role;
alter function public.recalculate_pos_ticket_input_earnings_for_date(uuid,date,uuid) set search_path=pg_catalog,public,pg_temp;

-- Receipt creation and Portable read models use the same independent tip input,
-- including fully discounted tickets and legacy percentage-tip tickets.
do $patch$
declare signature text; target regprocedure; d text;
begin
 foreach signature in array array[
  'public.insert_missing_pos_ticket_staff_earnings_for_ticket(uuid)',
  'public.get_pos_portable_ticket_data(uuid,text,date)',
  'public.get_pos_portable_report_data(uuid,text,date)'
 ] loop
  target:=to_regprocedure(signature);if target is null then continue;end if;
  d:=pg_get_functiondef(target);
  d:=replace(d,'when round(ticket_tax.taxable_amount + ticket_tax.tax_amount, 2) <= 0','when false');
  d:=replace(d,'when ticket_tax.taxable_amount + ticket_tax.tax_amount <= 0','when false');
  execute d;
 end loop;
end;$patch$;

-- Reuse the established validation and source-line edits. The public wrapper
-- below is the only authority for role/date, concurrency, note and event rules.
do $patch$
declare d text; a integer; b integer;
begin
 d:=replace(pg_get_functiondef('public.correct_pos_workspace_ticket_core(uuid,text,uuid,jsonb,jsonb,jsonb,jsonb,numeric,text)'::regprocedure),E'\r\n',E'\n');
 d:=replace(d,'correct_pos_workspace_ticket_core(', 'correct_pos_ticket_inputs_core(');
 a:=position('  select'||chr(10)||'    pos_daily_closings.status,' in d);b:=position('  drop table if exists pg_temp.portable_ticket_current_items;' in d);
 if a=0 or b<=a then raise exception 'Review ticket financial-date guard before source input migration';end if;
 d:=overlay(d placing '' from a for b-a);
 d:=replace(d,'recalculate_pos_ticket_staff_earnings_for_date(', 'recalculate_pos_ticket_input_earnings_for_date(');
 d:=replace(d,E'    (ticket_row.opened_at at time zone target_timezone)::date\n  );',E'    (ticket_row.opened_at at time zone target_timezone)::date, p_ticket_id\n  );');
 -- Valid receipt creation permits several service rows for one Staff and custom
 -- services with optional labels. Preserve those existing input shapes.
 if position(E'where final_items.staff_id is null\n      or cardinality(final_items.parts) = 0\n      or final_items.line_total <= 0' in d)=0
  or position('Active lines require staff and positive parts.' in d)=0
  or position(E'    row_index integer primary key,\n    service_id uuid,\n    staff_id uuid not null,' in d)=0
  or position(E'      added_payload.ordinality::integer,\n      service_uuid,\n      staff_uuid,' in d)=0
  or position(E'      added_row.service_id,\n      added_row.line_total' in d)=0
  or position(E'      salon_id,\n      service_id,\n      unit_price' in d)=0 then raise exception 'Review installed optional-service correction contract';end if;
 d:=replace(d,E'    row_index integer primary key,\n    service_id uuid,\n    staff_id uuid not null,',E'    row_index integer primary key,\n    service_id uuid,\n    service_label text,\n    staff_id uuid not null,');
 d:=replace(d,E'      row_index,\n      service_id,\n      staff_id,',E'      row_index,\n      service_id,\n      service_label,\n      staff_id,');
 d:=replace(d,E'      added_payload.ordinality::integer,\n      service_uuid,\n      staff_uuid,',
  E'      added_payload.ordinality::integer,\n      service_uuid,\n      coalesce(left(nullif(btrim(coalesce(added_payload.value->>''service_label'',added_payload.value->>''serviceLabel'','''')),''''),100),case when service_uuid is null then ''Custom service'' end),\n      staff_uuid,');
 d:=replace(d,E'      salon_id,\n      service_id,\n      unit_price',E'      salon_id,\n      service_id,\n      service_name_snapshot,\n      unit_price');
 d:=replace(d,E'      added_row.service_id,\n      added_row.line_total',E'      added_row.service_id,\n      added_row.service_label,\n      added_row.line_total');
 if position('Each staff member can appear only once on a ticket.' in d)=0 then raise exception 'Review Staff line cardinality validation';end if;
 d:=replace(d,E'  if final_staff_count <> final_staff_distinct_count then\n    raise exception ''Each staff member can appear only once on a ticket.'';\n  end if;',
  '  final_staff_count := final_staff_distinct_count;');
 d:=replace(d,E'  from pg_temp.portable_ticket_final_items final_items\n  left join public.pos_ticket_staff_earnings earnings',
  E'  from (select distinct staff_id from pg_temp.portable_ticket_final_items) final_items\n  left join public.pos_ticket_staff_earnings earnings');
 a:=position('  insert into public.pos_ticket_adjustments (' in d);b:=position('  return jsonb_build_object(' in substring(d from a));
 if a=0 or b=0 then raise exception 'Review ticket adjustment recording before source input migration';end if;
 d:=overlay(d placing '' from a for b-1);
 d:=replace(d,'when current_taxable + current_tax <= 0 or coalesce(ticket_row.tip_value, 0) <= 0 then 0','when coalesce(ticket_row.tip_value, 0) <= 0 then 0');
 execute d;
end;$patch$;
revoke all on function public.correct_pos_ticket_inputs_core(uuid,text,uuid,jsonb,jsonb,jsonb,jsonb,numeric,text) from public,anon,authenticated,service_role;
alter function public.correct_pos_ticket_inputs_core(uuid,text,uuid,jsonb,jsonb,jsonb,jsonb,numeric,text) set search_path=pg_catalog,public,pg_temp;

-- Newly captured correction snapshots retain custom labels. Old snapshots with
-- no label remain incomplete evidence; do not invent a historical catalog name.
do $patch$declare d text;begin
 d:=pg_get_functiondef('public.pos_ticket_correction_snapshot(uuid,uuid)'::regprocedure);
 d:=replace(d,'''service_id'', items.service_id,', '''service_id'', items.service_id, ''service_name_snapshot'', items.service_name_snapshot,');execute d;
end;$patch$;

create function public.assert_staff_day_inputs_nonnegative(p_salon uuid,p_date date)
returns void language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 if exists(
  select 1 from public.staff_day_financial_inputs d left join lateral (
   select coalesce(sum(e.service_total),0) gross,coalesce(sum(e.tip_amount),0) tip
   from public.pos_ticket_staff_earnings e join public.pos_tickets t on t.id=e.ticket_id and t.salon_id=e.salon_id
   where e.salon_id=d.salon_id and e.staff_id=d.staff_id and e.work_date=d.business_date and t.status='closed'
  ) source on true where d.salon_id=p_salon and d.business_date=p_date and
    (source.gross+d.service_delta<0 or source.tip+d.tip_delta<0)
 ) then raise exception 'This ticket edit would make the adjusted Staff day negative. Review the Staff day adjustment before saving.';end if;
end;$$;
revoke all on function public.assert_staff_day_inputs_nonnegative(uuid,date) from public,anon,authenticated,service_role;

create function public.save_pos_ticket_inputs(
 p_key uuid,p_signature text,p_salon uuid,p_ticket uuid,p_expected bigint,
 p_item_updates jsonb,p_item_parts jsonb,p_added_items jsonb,p_staff_tip_overrides jsonb,
 p_tip_total numeric,p_reason text,p_discount_type text,p_discount_value numeric,p_request uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare salon uuid; t public.pos_tickets%rowtype; scope text; fingerprint text; prior public.pos_ticket_input_requests%rowtype;
 work_date date; old_values jsonb; new_values jsonb; old_snapshot jsonb; after_snapshot jsonb; result jsonb; event uuid;
 has_line_or_tip_change boolean; dtype text; dvalue numeric; resolved_tip numeric;
begin
 if p_key is not null then
  salon:=public.pos_portable_access_salon_id(p_key,p_signature);
  if salon is null or not public.pos_portable_access_has_capability(p_key,p_signature,'portable.today.view') or not public.pos_portable_access_has_capability(p_key,p_signature,'portable.pos.use') then raise exception 'Not authorized';end if;
  scope:='portable:'||p_key::text;
 else
  salon:=p_salon;
  if auth.uid() is null or salon is null or not public.payroll_live_is_owner(salon) then raise exception 'Only the Owner can edit ticket inputs.' using errcode='42501';end if;
  scope:='owner:'||auth.uid()::text;
 end if;
 if not public.salon_is_operational(salon) then raise exception 'This salon is not active.';end if;
 if p_request is null or p_expected is null or p_ticket is null or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'Reload the ticket, make a change and enter an edit note.';end if;
 fingerprint:=md5(jsonb_build_object('ticket',p_ticket,'updates',p_item_updates,'parts',p_item_parts,'added',p_added_items,'tips',p_staff_tip_overrides,'tip',p_tip_total,'discount_type',p_discount_type,'discount_value',p_discount_value,'note',btrim(p_reason))::text);
 perform pg_advisory_xact_lock(hashtextextended('ticket-input-request:'||salon::text||p_request::text,0));
 select * into prior from public.pos_ticket_input_requests where salon_id=salon and request_id=p_request;
 if found then
  if prior.actor_scope<>scope or prior.ticket_id<>p_ticket or prior.fingerprint<>fingerprint then raise exception 'This request ID belongs to a different ticket edit.';end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 select * into t from public.pos_tickets where id=p_ticket and salon_id=salon;
 if not found then raise exception 'Ticket not found.';end if;
 work_date:=(t.opened_at at time zone public.get_salon_business_timezone(salon))::date;
 if p_key is not null and work_date<>public.get_salon_business_date(salon) then raise exception 'Portable can edit tickets only for the current salon business date.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('staff-day-input:'||salon::text||':'||work_date::text,0));
 select * into t from public.pos_tickets where id=p_ticket and salon_id=salon for update;
 if t.status<>'closed' then raise exception 'Open the completed ticket to edit its inputs.';end if;
 if t.workspace_revision<>p_expected then raise exception 'This ticket changed on another screen. Open the latest ticket and review your changes.';end if;
 if p_tip_total is not null and (p_tip_total<0 or p_tip_total<>round(p_tip_total,2) or p_tip_total::text in ('NaN','Infinity','-Infinity')) then raise exception 'Enter a valid tip amount with up to two decimals.';end if;
 dtype:=coalesce(p_discount_type,t.discount_type);dvalue:=coalesce(p_discount_value,t.discount_value);
 if dtype not in ('fixed_amount','percentage') or dvalue is null or dvalue<0 or dvalue<>round(dvalue,2) or dvalue::text in ('NaN','Infinity','-Infinity') or (dtype='percentage' and dvalue>100) then raise exception 'Enter a valid discount.';end if;
 old_values:=public.pos_ticket_input_snapshot(salon,p_ticket);
 resolved_tip:=coalesce(p_tip_total,(old_values->>'tip_amount')::numeric);
 old_snapshot:=public.pos_ticket_correction_snapshot(salon,p_ticket);
 -- The core validates each edited/added line and all manual tip allocations.
 has_line_or_tip_change:=jsonb_array_length(coalesce(p_item_updates,'[]'))>0 or jsonb_array_length(coalesce(p_added_items,'[]'))>0
  or jsonb_array_length(coalesce(p_staff_tip_overrides,'[]'))>0 or resolved_tip<>(old_values->>'tip_amount')::numeric;
 if has_line_or_tip_change then
  perform public.correct_pos_ticket_inputs_core(salon,null,p_ticket,p_item_updates,p_item_parts,p_added_items,p_staff_tip_overrides,resolved_tip,btrim(p_reason));
 end if;
 if dtype='fixed_amount' and dvalue>(select coalesce(sum(line_total),0) from public.pos_ticket_items where salon_id=salon and pos_ticket_id=p_ticket and not coalesce(is_removed,false)) then raise exception 'Discount cannot exceed service total.';end if;
 -- Persisting tip as an independent input also removes legacy percentage
 -- coupling. It never changes because the salon edits its discount.
 update public.pos_tickets set discount_type=dtype,discount_value=dvalue,tip_type='fixed_amount',tip_value=resolved_tip
  where id=p_ticket and salon_id=salon and (discount_type,discount_value,tip_type,tip_value) is distinct from (dtype,dvalue,'fixed_amount',resolved_tip);
 perform public.recalculate_pos_ticket_input_earnings_for_date(salon,work_date,p_ticket);
 perform public.assert_staff_day_inputs_nonnegative(salon,work_date);
 new_values:=public.pos_ticket_input_snapshot(salon,p_ticket);
 if old_values=new_values then
  result:=jsonb_build_object('ok',true,'unchanged',true,'ticketId',p_ticket,'workDate',work_date,'revision',(select workspace_revision from public.pos_tickets where id=p_ticket));
 else
  after_snapshot:=public.pos_ticket_correction_snapshot(salon,p_ticket);
  insert into public.pos_ticket_adjustments(salon_id,ticket_id,action,reason,before_snapshot,after_snapshot,created_by)
   values(salon,p_ticket,'item_corrected',btrim(p_reason),old_snapshot,after_snapshot,public.current_public_user_id());
  event:=public.record_financial_input_event(salon,'ticket',work_date,p_ticket,old_values,new_values,btrim(p_reason),public.pos_ticket_input_staff_changes(old_values,new_values),p_request,true);
  perform public.reconcile_daily_inputs(salon,work_date);
  update public.pos_tickets set updated_at=clock_timestamp() where id=p_ticket and salon_id=salon;
  result:=jsonb_build_object('ok',true,'ticketId',p_ticket,'workDate',work_date,'eventId',event,'revision',(select workspace_revision from public.pos_tickets where id=p_ticket));
 end if;
 insert into public.pos_ticket_input_requests(salon_id,request_id,actor_scope,ticket_id,fingerprint,result) values(salon,p_request,scope,p_ticket,fingerprint,result);
 return result;
end;$$;
revoke all on function public.save_pos_ticket_inputs(uuid,text,uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,numeric,text,text,numeric,uuid) from public;
grant execute on function public.save_pos_ticket_inputs(uuid,text,uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,numeric,text,text,numeric,uuid) to anon,authenticated;

-- Compatibility callers cannot bypass the logical-save boundary. They still
-- get revision protection; current clients also supply a durable request ID.
create or replace function public.correct_pos_workspace_ticket(
 p_key uuid,p_signature text,p_salon uuid,p_ticket uuid,p_expected bigint,
 p_item_updates jsonb,p_item_parts jsonb,p_added_items jsonb,p_staff_tip_overrides jsonb,p_tip_total numeric,p_reason text
) returns jsonb language sql security definer set search_path=pg_catalog,public,pg_temp as $$
 select public.save_pos_ticket_inputs(p_key,p_signature,p_salon,p_ticket,p_expected,p_item_updates,p_item_parts,p_added_items,p_staff_tip_overrides,p_tip_total,p_reason,null,null,gen_random_uuid());
$$;

create function public.record_pos_ticket_creation(p_salon uuid,p_ticket uuid,p_date date)
returns void language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare snapshot jsonb; event uuid;
begin
 if exists(select 1 from public.pos_ticket_input_creations where ticket_id=p_ticket) then return;end if;
 snapshot:=public.pos_ticket_input_snapshot(p_salon,p_ticket);
 if snapshot is null then raise exception 'Created ticket was not found.';end if;
 event:=public.record_financial_input_event(p_salon,'ticket',p_date,p_ticket,'{}'::jsonb,snapshot,'Ticket created',public.pos_ticket_input_staff_changes('{}'::jsonb,snapshot),p_ticket,true);
 insert into public.pos_ticket_input_creations(ticket_id,event_id) values(p_ticket,event);
 if snapshot->>'status'='closed' then perform public.reconcile_daily_inputs(p_salon,p_date);end if;
end;$$;
revoke all on function public.record_pos_ticket_creation(uuid,uuid,date) from public,anon,authenticated,service_role;

-- Wrap the installed receipt implementations after they have committed all
-- lines, recorded collection, tips and staff source rows in this transaction.
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.submit_owner_workspace_receipt_core(uuid,text,jsonb,date)'::regprocedure);
 d:=replace(d,'submit_owner_workspace_receipt_core(', 'submit_owner_workspace_receipt_before_input_events(');execute d;
 d:=pg_get_functiondef('public.submit_pos_portable_receipt(uuid,text,jsonb,date)'::regprocedure);
 d:=replace(d,'submit_pos_portable_receipt(', 'submit_pos_portable_receipt_before_input_events(');execute d;
end;$patch$;
revoke all on function public.submit_owner_workspace_receipt_before_input_events(uuid,text,jsonb,date),public.submit_pos_portable_receipt_before_input_events(uuid,text,jsonb,date) from public,anon,authenticated,service_role;

create or replace function public.submit_owner_workspace_receipt_core(p_key_id uuid,p_session_signature text,p_receipt jsonb,p_work_date date default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare result jsonb; day date:=coalesce(p_work_date,public.get_salon_business_date(p_key_id));
begin
 if not public.payroll_live_is_owner(p_key_id) then raise exception 'Only the Owner can submit this ticket.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('staff-day-input:'||p_key_id::text||':'||day::text,0));
 result:=public.submit_owner_workspace_receipt_before_input_events(p_key_id,p_session_signature,p_receipt,p_work_date);
 if result is not null then perform public.record_pos_ticket_creation(p_key_id,(result->>'ticketId')::uuid,day);end if;
 return result;
end;$$;
revoke all on function public.submit_owner_workspace_receipt_core(uuid,text,jsonb,date) from public,anon,authenticated,service_role;

create or replace function public.submit_pos_portable_receipt(p_key_id uuid,p_session_signature text,p_receipt jsonb,p_work_date date default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare result jsonb; salon uuid; day date; request uuid; fingerprint text; prior public.pos_ticket_input_requests%rowtype;
begin
 salon:=public.pos_portable_access_salon_id(p_key_id,p_session_signature);
 if salon is null or not public.pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.pos.use') then raise exception 'Not authorized';end if;
 day:=coalesce(p_work_date,public.get_salon_business_date(salon));
 request:=nullif(p_receipt->>'requestId','')::uuid;
 if request is null then raise exception 'Reload this receipt before submitting. A durable request ID is required.';end if;
 if request is not null then
  fingerprint:=md5(jsonb_build_object('receipt',p_receipt,'date',day)::text);
  perform pg_advisory_xact_lock(hashtextextended('ticket-input-request:'||salon::text||request::text,0));
  select * into prior from public.pos_ticket_input_requests where salon_id=salon and request_id=request;
  if found then
   if prior.actor_scope<>'portable:'||p_key_id::text or prior.fingerprint<>fingerprint then raise exception 'This request belongs to a different receipt.';end if;
   return prior.result;
  end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('staff-day-input:'||salon::text||':'||day::text,0));
 result:=public.submit_pos_portable_receipt_before_input_events(p_key_id,p_session_signature,p_receipt,p_work_date);
 if result is not null then perform public.record_pos_ticket_creation(salon,(result->>'ticketId')::uuid,day);end if;
 if result is not null and request is not null then
  insert into public.pos_ticket_input_requests(salon_id,request_id,actor_scope,ticket_id,fingerprint,result) values(salon,request,'portable:'||p_key_id::text,(result->>'ticketId')::uuid,fingerprint,result);
 end if;
 return result;
end;$$;
revoke all on function public.submit_pos_portable_receipt(uuid,text,jsonb,date) from public;
grant execute on function public.submit_pos_portable_receipt(uuid,text,jsonb,date) to anon,authenticated;

-- Older durable envelopes keep their operation/visit identity when crossing the
-- now-strict receipt boundary. A stale direct bundle must refresh first.
do $patch$declare target regprocedure; d text;begin
 target:=to_regprocedure('public.replay_pos_portable_operation(uuid,text,uuid,text,timestamptz,jsonb)');
 if target is not null then
  d:=pg_get_functiondef(target);
  if position('receipt := p_payload-''liveDraftToken'';' in d)=0 then raise exception 'Review Portable operation receipt identity';end if;
  d:=replace(d,'receipt := p_payload-''liveDraftToken'';', 'receipt := (p_payload-''liveDraftToken'') || jsonb_build_object(''requestId'',p_operation_id);');execute d;
 end if;
 target:=to_regprocedure('public.service_relay_submit(uuid,uuid,integer,numeric,numeric,uuid,text)');
 if target is not null then
  d:=pg_get_functiondef(target);
  if position('perform set_config(''reylumi.service_relay_visit'',p_visit::text,true);' in d)=0 then raise exception 'Review service relay receipt identity';end if;
  d:=replace(d,'perform set_config(''reylumi.service_relay_visit'',p_visit::text,true);',
   'receipt:=receipt||jsonb_build_object(''requestId'',p_visit);'||chr(10)||' perform set_config(''reylumi.service_relay_visit'',p_visit::text,true);');execute d;
 end if;
end;$patch$;

-- A booking conversion is an open draft, not a second financial submission.
-- Preserve its booking.manage authority and booking lock; serialize its input
-- creation with the Staff day editor. Final checkout records the logical event.
do $patch$declare target regprocedure; d text;begin
 target:=to_regprocedure('public.convert_booking_to_pos_ticket(uuid)');
 if target is not null then
  d:=replace(pg_get_functiondef(target),E'\r\n',E'\n');
  if position('  select coalesce(max(ticket_sequence), 0) + 1' in d)=0 then raise exception 'Review booking ticket draft creation before input migration';end if;
  d:=replace(d,'  select coalesce(max(ticket_sequence), 0) + 1',
   '  perform pg_advisory_xact_lock(hashtextextended(''staff-day-input:''||booking_row.salon_id::text||'':''||public.get_salon_business_date(booking_row.salon_id)::text,0));'||chr(10)||'  select coalesce(max(ticket_sequence), 0) + 1');
  execute d;
 end if;
end;$patch$;

create function public.mutate_owner_ticket_inputs(p_salon uuid,p_ticket uuid,p_expected bigint,p_request uuid,p_operation text,p_values jsonb,p_note text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare t public.pos_tickets%rowtype; i public.pos_ticket_items%rowtype; s public.services%rowtype;
 prior public.pos_ticket_input_requests%rowtype; fingerprint text; day date; before_values jsonb; after_values jsonb;
 old_snapshot jsonb; event uuid; result jsonb; amount numeric; input_quantity numeric; staff_key uuid; item_key uuid; total numeric; paid numeric; action text;
begin
 if auth.uid() is null or not public.payroll_live_is_owner(p_salon) then raise exception 'Only the Owner can edit ticket inputs.' using errcode='42501';end if;
 if p_request is null or p_expected is null or p_ticket is null or jsonb_typeof(p_values)<>'object' or length(btrim(coalesce(p_note,''))) not between 1 and 1000 then raise exception 'Reload this ticket and enter an edit note.';end if;
 if p_operation not in ('notes','discount','tax','tip','item_add','item_update','item_staff','item_remove','payment_add','payment_remove','checkout','cancel','void','reopen') then raise exception 'Unsupported ticket input operation.';end if;
 fingerprint:=md5(jsonb_build_object('ticket',p_ticket,'operation',p_operation,'values',p_values,'note',btrim(p_note))::text);
 perform pg_advisory_xact_lock(hashtextextended('ticket-input-request:'||p_salon::text||p_request::text,0));
 select * into prior from public.pos_ticket_input_requests where salon_id=p_salon and request_id=p_request;
 if found then
  if prior.actor_scope<>'owner:'||auth.uid()::text or prior.ticket_id<>p_ticket or prior.fingerprint<>fingerprint then raise exception 'This request ID belongs to a different ticket edit.';end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 select * into t from public.pos_tickets where id=p_ticket and salon_id=p_salon;
 if not found then raise exception 'Ticket not found in this salon.';end if;
 day:=(t.opened_at at time zone public.get_salon_business_timezone(p_salon))::date;
 perform pg_advisory_xact_lock(hashtextextended('staff-day-input:'||p_salon::text||':'||day::text,0));
 select * into t from public.pos_tickets where id=p_ticket and salon_id=p_salon for update;
 if t.workspace_revision<>p_expected then raise exception 'This ticket changed on another screen. Reload and review it.';end if;
 if (p_operation in ('void','reopen') and t.status<>'closed') or (p_operation not in ('void','reopen') and t.status<>'open') then raise exception 'This ticket status does not allow that operation.';end if;
 before_values:=public.pos_ticket_input_snapshot(p_salon,p_ticket);old_snapshot:=public.pos_ticket_correction_snapshot(p_salon,p_ticket);
 if t.tip_type='percentage' and p_operation<>'tip' then
  update public.pos_tickets set tip_type='fixed_amount',tip_value=(before_values->>'tip_amount')::numeric where id=p_ticket and salon_id=p_salon;
 end if;
 if p_operation='notes' then
  update public.pos_tickets set notes=nullif(btrim(p_values->>'notes'),'') where id=p_ticket and salon_id=p_salon;
 elsif p_operation='discount' then
  amount:=(p_values->>'discount_value')::numeric;
  if p_values->>'discount_type' not in ('fixed_amount','percentage') or amount is null or amount<0 or amount<>round(amount,2) or amount::text in ('NaN','Infinity','-Infinity') or (p_values->>'discount_type'='percentage' and amount>100) or (p_values->>'discount_type'='fixed_amount' and amount>(before_values->>'service_total')::numeric) then raise exception 'Enter a valid discount within the service total.';end if;
  update public.pos_tickets set discount_type=p_values->>'discount_type',discount_value=amount where id=p_ticket and salon_id=p_salon;
 elsif p_operation='tax' then
  amount:=(p_values->>'tax_rate')::numeric;
  if amount is null or amount<0 or amount>100 or amount::text in ('NaN','Infinity','-Infinity') then raise exception 'Enter a tax rate from 0 to 100.';end if;
  update public.pos_tickets set tax_rate=amount where id=p_ticket and salon_id=p_salon;
 elsif p_operation='tip' then
  amount:=(p_values->>'tip_value')::numeric;
  if p_values->>'tip_type' not in ('fixed_amount','percentage') or amount is null or amount<0 or amount<>round(amount,2) or amount::text in ('NaN','Infinity','-Infinity') or (p_values->>'tip_type'='percentage' and amount>100) then raise exception 'Enter a valid tip.';end if;
  if p_values->>'tip_type'='percentage' then amount:=round(((before_values->>'service_total')::numeric-(before_values->>'discount_amount')::numeric)*(1+t.tax_rate/100)*amount/100,2);end if;
  update public.pos_tickets set tip_type='fixed_amount',tip_value=amount where id=p_ticket and salon_id=p_salon;
 elsif p_operation='item_add' then
  select * into s from public.services where id=(p_values->>'service_id')::uuid and salon_id=p_salon and is_active;
  if not found then raise exception 'Choose an active service in this salon.';end if;
  insert into public.pos_ticket_items(salon_id,pos_ticket_id,service_id,service_name_snapshot,quantity,unit_price,line_total)
   values(p_salon,p_ticket,s.id,s.name,1,s.base_price,s.base_price);
 elsif p_operation in ('item_update','item_staff','item_remove') then
  select * into i from public.pos_ticket_items where id=(p_values->>'item_id')::uuid and salon_id=p_salon and pos_ticket_id=p_ticket and not coalesce(is_removed,false) for update;
  if not found then raise exception 'Active ticket item was not found.';end if;
  if p_operation='item_update' then
   amount:=(p_values->>'unit_price')::numeric;input_quantity:=(p_values->>'quantity')::numeric;
   if amount is null or amount<0 or amount<>round(amount,2) or amount::text in ('NaN','Infinity','-Infinity') or input_quantity is null or input_quantity<=0 or input_quantity>1000 or input_quantity::text in ('NaN','Infinity','-Infinity') then raise exception 'Enter a positive quantity and valid price.';end if;
   update public.pos_ticket_items set unit_price=amount,quantity=input_quantity,line_total=round(amount*input_quantity,2),notes=case when p_values?'notes' then nullif(btrim(p_values->>'notes'),'') else i.notes end where id=i.id and salon_id=p_salon;
   if (i.unit_price,i.quantity) is distinct from (amount,input_quantity) then
    perform public.rebuild_pos_ticket_item_turn_parts_for_correction(p_salon,p_ticket,i.id,i.assigned_staff_id,day,
     case when amount=0 then array[]::numeric[] when input_quantity=trunc(input_quantity) then array(select amount from generate_series(1,input_quantity::integer)) else array[round(amount*input_quantity,2)] end);
   end if;
  elsif p_operation='item_staff' then
   staff_key:=nullif(p_values->>'assigned_staff_id','')::uuid;
   if staff_key is not null and not exists(select 1 from public.staff where id=staff_key and salon_id=p_salon and is_active and pos_enabled) then raise exception 'Choose active Staff in this salon.';end if;
   update public.pos_ticket_items set assigned_staff_id=staff_key where id=i.id and salon_id=p_salon;
   perform public.rebuild_pos_ticket_item_turn_parts_for_correction(p_salon,p_ticket,i.id,staff_key,day,
    case when exists(select 1 from public.pos_ticket_item_turn_parts p where p.salon_id=p_salon and p.ticket_item_id=i.id)
     then array(select p.amount from public.pos_ticket_item_turn_parts p where p.salon_id=p_salon and p.ticket_item_id=i.id order by p.turn_index,p.id)
     when i.line_total>0 then array[i.line_total] else array[]::numeric[] end);
  else
   update public.pos_ticket_items set is_removed=true,removed_at=clock_timestamp(),removed_by=public.current_public_user_id(),removal_reason=btrim(p_note) where id=i.id and salon_id=p_salon;
   perform public.rebuild_pos_ticket_item_turn_parts_for_correction(p_salon,p_ticket,i.id,null,day,array[]::numeric[]);
  end if;
 elsif p_operation='payment_add' then
  amount:=(p_values->>'amount')::numeric;
  if amount is null or amount<=0 or amount<>round(amount,2) or amount::text in ('NaN','Infinity','-Infinity') or p_values->>'payment_method' not in ('cash','credit_card','debit_card','gift_card','other') then raise exception 'Choose a payment method and positive amount.';end if;
  insert into public.pos_payments(salon_id,ticket_id,payment_method,amount,note,created_by) values(p_salon,p_ticket,p_values->>'payment_method',amount,btrim(p_note),public.current_public_user_id());
 elsif p_operation='payment_remove' then
  delete from public.pos_payments where id=(p_values->>'payment_id')::uuid and salon_id=p_salon and ticket_id=p_ticket;
  if not found then raise exception 'Payment was not found on this ticket.';end if;
 elsif p_operation='checkout' then
  if not exists(select 1 from public.pos_ticket_items where salon_id=p_salon and pos_ticket_id=p_ticket and not coalesce(is_removed,false)) then raise exception 'Add a ticket item before checkout.';end if;
  total:=round((before_values->>'service_total')::numeric-(before_values->>'discount_amount')::numeric,2);
  total:=total+round(total*t.tax_rate/100,2)+(before_values->>'tip_amount')::numeric;
  paid:=(before_values->>'recorded_payment_total')::numeric;
  if total<=0 or total<>paid then raise exception 'Ticket must be fully paid with no overpayment before checkout.';end if;
  update public.pos_tickets set status='closed',closed_at=clock_timestamp() where id=p_ticket and salon_id=p_salon;
 elsif p_operation='cancel' then update public.pos_tickets set status='cancelled' where id=p_ticket and salon_id=p_salon;
 elsif p_operation='void' then update public.pos_tickets set status='voided' where id=p_ticket and salon_id=p_salon;
 elsif p_operation='reopen' then update public.pos_tickets set status='open',closed_at=null where id=p_ticket and salon_id=p_salon;
 end if;
 -- Open work is a draft, never an earning. Existing completed-source rows are
 -- zeroed when a ticket is voided/reopened; payment/payroll ledgers are retained.
 if p_operation in ('checkout','void','reopen') then perform public.recalculate_pos_ticket_input_earnings_for_date(p_salon,day,p_ticket);end if;
 perform public.assert_staff_day_inputs_nonnegative(p_salon,day);
 after_values:=public.pos_ticket_input_snapshot(p_salon,p_ticket);
 if before_values=after_values then result:=jsonb_build_object('ok',true,'unchanged',true,'ticketId',p_ticket);
 else
  insert into public.pos_ticket_adjustments(salon_id,ticket_id,action,reason,before_snapshot,after_snapshot,created_by) values(p_salon,p_ticket,'item_corrected',btrim(p_note),old_snapshot,public.pos_ticket_correction_snapshot(p_salon,p_ticket),public.current_public_user_id());
  event:=public.record_financial_input_event(p_salon,'ticket',day,p_ticket,before_values,after_values,btrim(p_note),public.pos_ticket_input_staff_changes(before_values,after_values),p_request,true);
  if p_operation in ('checkout','void','reopen') then perform public.reconcile_daily_inputs(p_salon,day);end if;
  update public.pos_tickets set updated_at=clock_timestamp() where id=p_ticket and salon_id=p_salon;
  if p_operation in ('checkout','cancel','void','reopen') then
   action:=case p_operation when 'checkout' then 'ticket_checked_out' when 'cancel' then 'ticket_cancelled' when 'void' then 'ticket_voided' else 'ticket_reopened' end;
   insert into public.pos_ticket_audit_logs(salon_id,ticket_id,action,note,created_by) values(p_salon,p_ticket,action,btrim(p_note),public.current_public_user_id());
  end if;
  result:=jsonb_build_object('ok',true,'ticketId',p_ticket,'eventId',event);
 end if;
 result:=result||jsonb_build_object('revision',(select workspace_revision from public.pos_tickets where id=p_ticket));
 insert into public.pos_ticket_input_requests(salon_id,request_id,actor_scope,ticket_id,fingerprint,result) values(p_salon,p_request,'owner:'||auth.uid()::text,p_ticket,fingerprint,result);
 return result;
end;$$;
revoke all on function public.mutate_owner_ticket_inputs(uuid,uuid,bigint,uuid,text,jsonb,text) from public,anon;
grant execute on function public.mutate_owner_ticket_inputs(uuid,uuid,bigint,uuid,text,jsonb,text) to authenticated;

create function public.submit_owner_ticket_inputs(p_salon uuid,p_receipt jsonb,p_request uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare prior public.pos_ticket_input_requests%rowtype; result jsonb; fingerprint text:=md5(p_receipt::text);
begin
 if auth.uid() is null or not public.payroll_live_is_owner(p_salon) then raise exception 'Only the Owner can submit this ticket.' using errcode='42501';end if;
 if p_request is null or jsonb_typeof(p_receipt)<>'object' then raise exception 'Reload this receipt before submitting.';end if;
 perform pg_advisory_xact_lock(hashtextextended('ticket-input-request:'||p_salon::text||p_request::text,0));
 select * into prior from public.pos_ticket_input_requests where salon_id=p_salon and request_id=p_request;
 if found then
  if prior.actor_scope<>'owner:'||auth.uid()::text or prior.fingerprint<>fingerprint then raise exception 'This request belongs to a different receipt.';end if;
  return prior.result;
 end if;
 result:=public.submit_owner_workspace_receipt_core(p_salon,null,p_receipt,public.get_salon_business_date(p_salon));
 insert into public.pos_ticket_input_requests(salon_id,request_id,actor_scope,ticket_id,fingerprint,result) values(p_salon,p_request,'owner:'||auth.uid()::text,(result->>'ticketId')::uuid,fingerprint,result);
 return result;
end;$$;
revoke all on function public.submit_owner_ticket_inputs(uuid,jsonb,uuid) from public,anon;
grant execute on function public.submit_owner_ticket_inputs(uuid,jsonb,uuid) to authenticated;

create function public.create_owner_open_ticket(p_salon uuid,p_customer uuid,p_opened_at timestamptz,p_notes text,p_request uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare prior public.pos_ticket_input_requests%rowtype; ticket uuid; day date; fingerprint text; result jsonb;
begin
 if auth.uid() is null or not public.payroll_live_is_owner(p_salon) then raise exception 'Only the Owner can create this ticket.' using errcode='42501';end if;
 if p_request is null then raise exception 'Reload this ticket form before creating it.';end if;
 fingerprint:=md5(jsonb_build_object('customer',p_customer,'opened_at',p_opened_at,'notes',p_notes)::text);
 perform pg_advisory_xact_lock(hashtextextended('ticket-input-request:'||p_salon::text||p_request::text,0));
 select * into prior from public.pos_ticket_input_requests where salon_id=p_salon and request_id=p_request;
 if found then
  if prior.actor_scope<>'owner:'||auth.uid()::text or prior.fingerprint<>fingerprint then raise exception 'This request belongs to a different ticket.';end if;
  return prior.result;
 end if;
 if p_customer is not null and not exists(select 1 from public.customers where id=p_customer and location_id=p_salon) then raise exception 'Choose a customer in this salon.';end if;
 day:=(coalesce(p_opened_at,clock_timestamp()) at time zone public.get_salon_business_timezone(p_salon))::date;
 perform pg_advisory_xact_lock(hashtextextended('staff-day-input:'||p_salon::text||':'||day::text,0));
 insert into public.pos_tickets(salon_id,customer_id,opened_at,notes,status) values(p_salon,p_customer,coalesce(p_opened_at,clock_timestamp()),nullif(btrim(p_notes),''),'open') returning id into ticket;
 perform public.record_pos_ticket_creation(p_salon,ticket,day);
 result:=jsonb_build_object('ok',true,'ticketId',ticket,'revision',0);
 insert into public.pos_ticket_input_requests(salon_id,request_id,actor_scope,ticket_id,fingerprint,result) values(p_salon,p_request,'owner:'||auth.uid()::text,ticket,fingerprint,result);
 return result;
end;$$;
revoke all on function public.create_owner_open_ticket(uuid,uuid,timestamptz,text,uuid) from public,anon;
grant execute on function public.create_owner_open_ticket(uuid,uuid,timestamptz,text,uuid) to authenticated;

-- Legacy server-side refreshes may repair the derived source cache, but cannot
-- call the older delete/reinsert function through the table API.
revoke all on function public.recalculate_pos_ticket_staff_earnings_for_date(uuid,date) from public,anon,authenticated,service_role;
create function public.refresh_owner_ticket_source_earnings(p_salon uuid,p_date date)
returns integer language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare refreshed integer;
begin
 if auth.uid() is null or not public.payroll_live_is_owner(p_salon) then raise exception 'Only the Owner can refresh ticket source earnings.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('staff-day-input:'||p_salon::text||':'||p_date::text,0));
 refreshed:=public.recalculate_pos_ticket_input_earnings_for_date(p_salon,p_date);
 perform public.assert_staff_day_inputs_nonnegative(p_salon,p_date);
 return refreshed;
end;$$;
revoke all on function public.refresh_owner_ticket_source_earnings(uuid,date) from public,anon;
grant execute on function public.refresh_owner_ticket_source_earnings(uuid,date) to authenticated;

-- These older entry points have no revision, durable request or required note.
-- Installed SECURITY DEFINER receipts may still call the private primitives.
do $$declare signature text; target regprocedure;begin
 foreach signature in array array[
  'public.update_closed_pos_ticket_tip_for_correction(uuid,text,numeric)',
  'public.correct_pos_portable_closed_ticket(uuid,text,uuid,jsonb,jsonb,jsonb,jsonb,numeric,text)',
  'public.correct_pos_workspace_ticket_core(uuid,text,uuid,jsonb,jsonb,jsonb,jsonb,numeric,text)',
  'public.insert_missing_pos_ticket_staff_earnings_for_ticket(uuid)',
  'public.submit_pos_portable_receipt_without_booking(uuid,text,jsonb,date)'
 ] loop
  target:=to_regprocedure(signature);if target is not null then execute format('revoke all on function %s from public,anon,authenticated,service_role',target);end if;
 end loop;
end;$$;

-- Financial source inputs must cross an authorized atomic command. The guard
-- runs as invoker: a SECURITY DEFINER command is allowed; a direct Owner or
-- Manager table API write is rejected. Payroll binding metadata stays writable.
create function public.guard_ticket_input_command_boundary() returns trigger language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
 if current_user in ('anon','authenticated') then
  if tg_table_name='pos_ticket_staff_earnings' and tg_op='UPDATE' and
   (to_jsonb(new)-array['locked_at','payroll_batch_id','updated_at'])=(to_jsonb(old)-array['locked_at','payroll_batch_id','updated_at']) then return new;end if;
  raise exception 'Use the authorized ticket input command to preserve history.' using errcode='42501';
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end;$$;
revoke all on function public.guard_ticket_input_command_boundary() from public,anon,authenticated,service_role;
do $$declare t text;begin
 foreach t in array array['pos_tickets','pos_ticket_items','pos_ticket_item_turn_parts','pos_ticket_staff_earnings','pos_payments','pos_ticket_adjustments','pos_ticket_audit_logs'] loop
  execute format('create trigger ticket_input_command_boundary before insert or update or delete on public.%I for each row execute function public.guard_ticket_input_command_boundary()',t);
 end loop;
end;$$;
notify pgrst,'reload schema';
commit;
