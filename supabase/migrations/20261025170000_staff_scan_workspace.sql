begin;

-- Explicit Scan connections share the existing POS relay and receipt core.
-- They never enter the automatic Phone Checkin dispatcher.
alter table public.service_relay_tickets add column scan_mode boolean not null default false;
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.pos_dispatch_service_relay(uuid)'::regprocedure);
 if position('status in (''waiting'',''in_service'') order by queue_number' in definition)=0 then raise exception 'Review relay dispatcher before installing Scan'; end if;
 if cardinality(string_to_array(definition,'status in (''waiting'',''in_service'') order by queue_number'))<>2 then raise exception 'Expected exactly one migration rewrite target: 20261025170000_staff_scan_workspace.sql #1'; end if;
 definition:=replace(definition,'status in (''waiting'',''in_service'') order by queue_number','status in (''waiting'',''in_service'') and not scan_mode order by queue_number');
 execute definition;
 definition:=pg_get_functiondef('public.service_relay_payload(uuid)'::regprocedure);
 if cardinality(string_to_array(definition,'''revision'',t.revision,'))<>2 then raise exception 'Expected exactly one migration rewrite target: 20261025170000_staff_scan_workspace.sql #2'; end if;
 definition:=replace(definition,'''revision'',t.revision,','''revision'',t.revision,''scanMode'',t.scan_mode,');
 if cardinality(string_to_array(definition,'''queueNumber'',t.queue_number'))<>2 then raise exception 'Expected exactly one migration rewrite target: 20261025170000_staff_scan_workspace.sql #3'; end if;
 definition:=replace(definition,'''queueNumber'',t.queue_number','''queueNumber'',coalesce((select r.queue_number from checkin_receipts r where r.visit_id=t.visit_id),t.queue_number)');
 execute definition;
end $$;

create function public.staff_scan_available(p_salon uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from checkin_receipt_subscriptions where salon_id=p_salon and paid_until>now())
 or exists(select 1 from salon_market_plugins where salon_id=p_salon and plugin_id='service-relay')
$$;

create function public.staff_scan_reconcile(p_salon uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('service-relay:'||p_salon::text,0));
 -- A ticket saved by POS is authoritative, even if the phone never sent Done.
 update service_relay_tickets t set status=case when v.ticket_id is not null then 'completed' else v.status end,
  pos_ticket_id=coalesce(v.ticket_id,t.pos_ticket_id),revision=revision+1
 from customer_visits v where t.salon_id=p_salon and t.visit_id=v.id
 and (v.ticket_id is not null or v.status in ('completed','cancelled'))
 and (t.status not in ('completed','cancelled') or t.pos_ticket_id is distinct from v.ticket_id);
 update service_relay_offers o set status='expired' from service_relay_tickets t
 where t.salon_id=p_salon and t.visit_id=o.visit_id and t.status in ('completed','cancelled') and o.status in ('offered','working');
end $$;

create function public.staff_scan_workspace(p_salon uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid; enabled boolean;
begin
 actor:=service_relay_staff(p_salon);
 if actor is null then raise exception 'Open your Staff workspace first'; end if;
 perform staff_scan_reconcile(p_salon);
 enabled:=staff_scan_available(p_salon);
 if enabled then
  insert into service_relay_tickets(visit_id,salon_id,scan_mode)
  select v.id,v.salon_id,true from customer_visits v where v.salon_id=p_salon
  and v.status in ('waiting','in_service','checkout') and v.ticket_id is null
  on conflict(visit_id) do nothing;
 end if;
 return jsonb_build_object('enabled',enabled,'staffId',actor,
  'current',coalesce((select jsonb_agg(service_relay_payload(t.visit_id) order by t.created_at desc)
   from service_relay_tickets t
   where t.salon_id=p_salon and t.scan_mode and t.status not in ('completed','cancelled')
   and exists(select 1 from service_relay_offers o where o.visit_id=t.visit_id and o.staff_id=actor
    and (o.status='working' or (o.status='done' and exists(select 1 from service_relay_lines l where l.offer_id=o.id))))),'[]'::jsonb),
  'waiting',case when enabled then coalesce((select jsonb_agg(jsonb_build_object(
   'visitId',v.id,'customerName',c.name,'queueNumber',coalesce(r.queue_number,t.queue_number),
   'checkedInAt',v.checked_in_at,'status',v.status,
   'workingStaffName',(select s.display_name from service_relay_offers o join staff s on s.id=o.staff_id
    where o.visit_id=v.id and o.status in ('offered','working') limit 1),
   'requestedServices',customer_visit_requested_services_json(v.id)) order by v.checked_in_at,v.id)
   from customer_visits v join customers c on c.id=v.customer_id and c.location_id=p_salon
   join service_relay_tickets t on t.visit_id=v.id left join checkin_receipts r on r.visit_id=v.id and r.salon_id=p_salon
   where v.salon_id=p_salon and v.ticket_id is null and v.status in ('waiting','in_service','checkout')),'[]'::jsonb) else '[]'::jsonb end,
  'services',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'price',s.base_price) order by s.name)
   from services s where s.salon_id=p_salon and s.is_active and exists(select 1 from staff_service_assignments a
    where a.staff_id=actor and a.salon_id=p_salon and a.service_id=s.id and a.is_active
    and (a.effective_start_date is null or a.effective_start_date<=get_salon_business_date(p_salon))
    and (a.effective_end_date is null or a.effective_end_date>=get_salon_business_date(p_salon)))),'[]'::jsonb));
end $$;

create function public.staff_scan_connect(p_salon uuid,p_visit uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid; t service_relay_tickets; v customer_visits; o service_relay_offers;
begin
 actor:=service_relay_staff(p_salon);
 if actor is null or not staff_scan_available(p_salon) then raise exception 'Scan is unavailable in this salon'; end if;
 perform staff_scan_reconcile(p_salon);
 select * into v from customer_visits where id=p_visit and salon_id=p_salon for update;
 if v.id is null or v.ticket_id is not null or v.status not in ('waiting','in_service','checkout') then raise exception 'This check-in is no longer available'; end if;
 if coalesce((select staff_check_in_enabled from pos_settings where salon_id=p_salon),false)
 and not exists(select 1 from staff_workdays where salon_id=p_salon and staff_id=actor and work_date=get_salon_business_date(p_salon) and status='working')
 then raise exception 'Check in for work before receiving a customer'; end if;
 insert into service_relay_tickets(visit_id,salon_id,scan_mode) values(p_visit,p_salon,true) on conflict(visit_id) do nothing;
 select * into t from service_relay_tickets where visit_id=p_visit for update;
 select * into o from service_relay_offers where visit_id=p_visit and staff_id=actor and status='working';
 if o.id is not null then
  update service_relay_tickets set scan_mode=true where visit_id=p_visit;
  return service_relay_payload(p_visit);
 end if;
 -- Scanning the same finished work again must not create a second Holding/turn.
 if exists(select 1 from service_relay_offers where visit_id=p_visit and staff_id=actor and status='done') then
  return service_relay_payload(p_visit);
 end if;
 if exists(select 1 from service_relay_offers where (visit_id=p_visit or staff_id=actor) and status in ('offered','working')
  and not (visit_id=p_visit and staff_id=actor and status='offered')) then raise exception 'A customer is already connected. Finish that work first.'; end if;
 select * into o from service_relay_offers where visit_id=p_visit and staff_id=actor and status='offered' for update;
 if o.id is null then
  insert into service_relay_offers(visit_id,staff_id,status) values(p_visit,actor,'working');
 else update service_relay_offers set status='working' where id=o.id; end if;
 update service_relay_tickets set scan_mode=true,status='in_service',revision=revision+1 where visit_id=p_visit;
 update customer_visits set status='in_service' where id=p_visit;
 return service_relay_payload(p_visit);
end $$;

create function public.staff_scan_save(p_salon uuid,p_offer uuid,p_lines jsonb,p_done boolean,p_expected integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid; t service_relay_tickets; o service_relay_offers; line jsonb;
begin
 actor:=service_relay_staff(p_salon);
 perform staff_scan_reconcile(p_salon);
 select * into o from service_relay_offers where id=p_offer for update;
 select * into t from service_relay_tickets where visit_id=o.visit_id and salon_id=p_salon for update;
 if actor is null or o.staff_id is distinct from actor or t.visit_id is null or not t.scan_mode then raise exception 'Not authorized'; end if;
 if t.status in ('completed','cancelled') then raise exception 'POS has saved or closed this ticket. Open Your tickets.'; end if;
 -- Repeated Done cannot count twice. Stale edits may never reopen Done work.
 if o.status='done' and p_done is true then return service_relay_payload(t.visit_id); end if;
 if o.status<>'working' or t.revision is distinct from p_expected then raise exception 'POS changed this work. Refresh before editing.'; end if;
 if p_done is null or p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)>30
 or (p_done and jsonb_array_length(p_lines)=0) then raise exception 'Choose a service and enter its amount'; end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(p_lines) x)<>jsonb_array_length(p_lines) then raise exception 'Duplicate service line'; end if;
 for line in select value from jsonb_array_elements(p_lines) loop
  if not exists(select 1 from services s join staff_service_assignments a on a.service_id=s.id and a.salon_id=s.salon_id
   where s.id=(line->>'serviceId')::uuid and s.salon_id=p_salon and s.is_active and a.staff_id=actor and a.is_active
   and (a.effective_start_date is null or a.effective_start_date<=get_salon_business_date(p_salon))
   and (a.effective_end_date is null or a.effective_end_date>=get_salon_business_date(p_salon))) then raise exception 'Service is not enabled for you'; end if;
  if coalesce(line->>'amount','') !~ '^\d+(\.\d{1,2})?$' or (line->>'amount')::numeric<=0 then raise exception 'Enter a positive amount with up to two decimals'; end if;
  if exists(select 1 from service_relay_lines where id=(line->>'id')::uuid and offer_id<>o.id) then raise exception 'Line belongs to another staff member'; end if;
 end loop;
 delete from service_relay_lines where offer_id=o.id and id not in(select (x->>'id')::uuid from jsonb_array_elements(p_lines) x);
 for line in select value from jsonb_array_elements(p_lines) loop
  insert into service_relay_lines(id,offer_id,service_id,amount) values((line->>'id')::uuid,o.id,(line->>'serviceId')::uuid,(line->>'amount')::numeric)
  on conflict(id) do update set service_id=excluded.service_id,amount=excluded.amount,revision=service_relay_lines.revision+1;
 end loop;
 if p_done then update service_relay_offers set status='done' where id=o.id; end if;
 update service_relay_tickets set revision=revision+1,status=case when p_done then 'checkout' else 'in_service' end where visit_id=t.visit_id;
 update customer_visits set status=case when p_done then 'checkout' else 'in_service' end where id=t.visit_id;
 return service_relay_payload(t.visit_id);
end $$;

create function public.staff_scan_connect_pass(p_salon uuid,p_pass uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare visit uuid;
begin
 if service_relay_staff(p_salon) is null then raise exception 'Not authorized'; end if;
 select visit_id into visit from service_relay_tickets where salon_id=p_salon and pass_token=p_pass;
 if visit is null then raise exception 'Check-in is unavailable in this salon'; end if;
 return staff_scan_connect(p_salon,visit);
end $$;

create function public.staff_scan_cancel(p_salon uuid,p_offer uuid,p_expected integer) returns void
language plpgsql security definer set search_path=public as $$
declare actor uuid; t service_relay_tickets; o service_relay_offers;
begin
 actor:=service_relay_staff(p_salon);
 perform staff_scan_reconcile(p_salon);
 select * into o from service_relay_offers where id=p_offer for update;
 select * into t from service_relay_tickets where visit_id=o.visit_id and salon_id=p_salon for update;
 if actor is null or o.staff_id is distinct from actor or t.visit_id is null or not t.scan_mode then raise exception 'Not authorized'; end if;
 if o.status<>'working' or t.status<>'in_service' or t.revision is distinct from p_expected then raise exception 'POS changed this work. Refresh first.'; end if;
 if exists(select 1 from service_relay_lines where offer_id=o.id) then raise exception 'Saved work remains connected. Close the editor to discard unsaved edits.'; end if;
 update service_relay_offers set status='declined' where id=o.id;
 update service_relay_tickets set revision=revision+1,status=case when exists(select 1 from service_relay_offers where visit_id=t.visit_id and status='done') then 'checkout' else 'waiting' end where visit_id=t.visit_id;
 update customer_visits set status=(select status from service_relay_tickets where visit_id=t.visit_id) where id=t.visit_id;
end $$;

-- Done counts provisionally; payment replaces this projection with receipt turns.
-- Holding reserves a place in the queue without inflating completed large turns.
create or replace function public.pos_service_relay_pending_turns(p_salon uuid,p_staff uuid) returns bigint
language sql stable security definer set search_path=public as $$
 select count(*) from service_relay_lines l join service_relay_offers o on o.id=l.offer_id
 join service_relay_tickets t on t.visit_id=o.visit_id join customer_visits v on v.id=t.visit_id
 where t.salon_id=p_salon and o.staff_id=p_staff and t.status in ('in_service','checkout') and v.ticket_id is null
 and (o.status='done' or (not t.scan_mode and o.status='working'))
 and l.amount>=coalesce((select large_turn_threshold from pos_settings where salon_id=p_salon),25)
$$;
create or replace function public.pos_service_relay_project_staff(p_salon uuid,p_payload jsonb) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare member jsonb; projected jsonb:='[]'; pending bigint; small_pending bigint; holding bigint; working boolean;
begin
 if p_payload is null or jsonb_typeof(p_payload->'staff')<>'array' then return p_payload; end if;
 for member in select value from jsonb_array_elements(p_payload->'staff') loop
  pending:=pos_service_relay_pending_turns(p_salon,(member->>'id')::uuid);
  select count(*) into small_pending from service_relay_lines l join service_relay_offers o on o.id=l.offer_id
  join service_relay_tickets t on t.visit_id=o.visit_id join customer_visits v on v.id=t.visit_id
  where t.salon_id=p_salon and t.scan_mode and o.staff_id=(member->>'id')::uuid and o.status='done'
  and t.status in ('in_service','checkout') and v.ticket_id is null
  and l.amount<coalesce((select large_turn_threshold from pos_settings where salon_id=p_salon),25);
  select count(*),coalesce(bool_or(o.status='working'),false) into holding,working
  from service_relay_offers o join service_relay_tickets t on t.visit_id=o.visit_id join customer_visits v on v.id=t.visit_id
  where t.salon_id=p_salon and t.scan_mode and o.staff_id=(member->>'id')::uuid and o.status='working'
  and t.status='in_service' and v.ticket_id is null;
  working:=working or exists(select 1 from service_relay_offers o join service_relay_tickets t on t.visit_id=o.visit_id
   join customer_visits v on v.id=t.visit_id where t.salon_id=p_salon and o.staff_id=(member->>'id')::uuid
   and o.status='working' and t.status='in_service' and v.ticket_id is null);
  member:=member||jsonb_build_object('service_status',case when working then 'working' else 'ready' end,
   'turns',coalesce(member->'turns','{}'::jsonb)||jsonb_build_object('pendingTurns',pending,'pendingSmallTurns',small_pending,'holdingTurns',holding,
    'queueTurns',coalesce((member->'turns'->>'queueTurns')::numeric,0)+pending+holding,
    'largeTurns',coalesce((member->'turns'->>'largeTurns')::numeric,0)+pending,
    'smallTurns',coalesce((member->'turns'->>'smallTurns')::numeric,0)+small_pending,
    'totalTurns',coalesce((member->'turns'->>'totalTurns')::numeric,0)+pending+small_pending));
  projected:=projected||jsonb_build_array(member);
 end loop;
 return jsonb_set(p_payload,'{staff}',projected);
end $$;

-- POS can correct services/amounts and finish work without the staff's phone.
create function public.staff_scan_desk_save(p_salon uuid,p_visit uuid,p_expected integer,p_lines jsonb,p_key uuid default null,p_signature text default null) returns void
language plpgsql security definer set search_path=public as $$
declare t service_relay_tickets; line jsonb; o service_relay_offers; selected_staff uuid;
begin
 if not coalesce(user_has_salon_permission(p_salon,array['tickets.manage']),false)
 and not coalesce(pos_portable_access_salon_id(p_key,p_signature)=p_salon and pos_portable_access_has_capability(p_key,p_signature,'portable.pos.use'),false) then raise exception 'Not authorized'; end if;
 perform staff_scan_reconcile(p_salon);
 select * into t from service_relay_tickets where visit_id=p_visit and salon_id=p_salon for update;
 if t.visit_id is null or t.status in ('completed','cancelled') or t.revision is distinct from p_expected then raise exception 'Ticket changed. Refresh before saving.'; end if;
 if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 30 then raise exception 'Add a service and amount'; end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(p_lines) x)<>jsonb_array_length(p_lines) then raise exception 'Duplicate service line'; end if;
 for line in select value from jsonb_array_elements(p_lines) loop
  selected_staff:=(line->>'staffId')::uuid;
  if not exists(select 1 from staff where id=selected_staff and salon_id=p_salon and is_active and pos_enabled) then raise exception 'Staff is not available'; end if;
  if not exists(select 1 from services where id=(line->>'serviceId')::uuid and salon_id=p_salon and is_active) then raise exception 'Service is not available'; end if;
  if coalesce(line->>'amount','') !~ '^\d+(\.\d{1,2})?$' or (line->>'amount')::numeric<=0 then raise exception 'Enter a positive amount'; end if;
  if exists(select 1 from service_relay_lines l join service_relay_offers x on x.id=l.offer_id where l.id=(line->>'id')::uuid and x.visit_id<>p_visit) then raise exception 'Line belongs to another ticket'; end if;
 end loop;
 -- Taking over makes every old staff revision invalid in the same transaction.
 update service_relay_offers set status='done' where visit_id=p_visit and status='working';
 update service_relay_offers set status='expired' where visit_id=p_visit and status='offered';
 delete from service_relay_lines where offer_id in(select id from service_relay_offers where visit_id=p_visit)
 and id not in(select (x->>'id')::uuid from jsonb_array_elements(p_lines) x);
 for line in select value from jsonb_array_elements(p_lines) loop
  select * into o from service_relay_offers where visit_id=p_visit and staff_id=(line->>'staffId')::uuid and status='done' order by created_at limit 1;
  if o.id is null then insert into service_relay_offers(visit_id,staff_id,status) values(p_visit,(line->>'staffId')::uuid,'done') returning * into o; end if;
  insert into service_relay_lines(id,offer_id,service_id,amount) values((line->>'id')::uuid,o.id,(line->>'serviceId')::uuid,(line->>'amount')::numeric)
  on conflict(id) do update set offer_id=excluded.offer_id,service_id=excluded.service_id,amount=excluded.amount,revision=service_relay_lines.revision+1;
 end loop;
 update service_relay_tickets set scan_mode=true,status='checkout',revision=revision+1 where visit_id=p_visit;
 update customer_visits set status='checkout' where id=p_visit;
end $$;

-- Preserve settlement, commission, tax, receipt and idempotency logic already installed.
-- A scan ticket with saved amounts can be collected before Staff presses Done.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.service_relay_submit(uuid,uuid,integer,numeric,numeric,uuid,text)'::regprocedure);
 if position('if t.status<>''checkout'' or p_expected is null' in definition)=0 then raise exception 'Review relay settlement before installing Scan'; end if;
 if cardinality(string_to_array(definition,'select * into t from service_relay_tickets where visit_id=p_visit and salon_id=p_salon for update;'))<>2 then raise exception 'Expected exactly one migration rewrite target: 20261025170000_staff_scan_workspace.sql #4'; end if;
 definition:=replace(definition,'select * into t from service_relay_tickets where visit_id=p_visit and salon_id=p_salon for update;',
  'perform staff_scan_reconcile(p_salon); select * into t from service_relay_tickets where visit_id=p_visit and salon_id=p_salon for update;');
 if cardinality(string_to_array(definition,'if t.status<>''checkout'' or p_expected is null'))<>2 then raise exception 'Expected exactly one migration rewrite target: 20261025170000_staff_scan_workspace.sql #5'; end if;
 definition:=replace(definition,'if t.status<>''checkout'' or p_expected is null',
  'if t.scan_mode and t.status=''in_service'' and t.revision=p_expected and exists(select 1 from service_relay_lines l join service_relay_offers o on o.id=l.offer_id where o.visit_id=p_visit and o.status in (''working'',''done'')) then
    update service_relay_offers set status=''done'' where visit_id=p_visit and status=''working'';
    update service_relay_offers set status=''expired'' where visit_id=p_visit and status=''offered'';
    update service_relay_tickets set status=''checkout'' where visit_id=p_visit;
    t.status:=''checkout'';
   end if;
   if t.status<>''checkout'' or p_expected is null');
 execute definition;
 -- Keep the desk's installed portable/owner authorization and legacy work visible.
 definition:=pg_get_functiondef('public.service_relay_workspace(uuid,boolean,uuid,text)'::regprocedure);
 if cardinality(string_to_array(definition,'perform pos_dispatch_service_relay(p_salon);'))<>2 then raise exception 'Expected exactly one migration rewrite target: 20261025170000_staff_scan_workspace.sql #6'; end if;
 definition:=replace(definition,'perform pos_dispatch_service_relay(p_salon);','perform staff_scan_reconcile(p_salon); perform pos_dispatch_service_relay(p_salon);');
 if cardinality(string_to_array(definition,'''services'',coalesce('))<>2 then raise exception 'Expected exactly one migration rewrite target: 20261025170000_staff_scan_workspace.sql #7'; end if;
 definition:=replace(definition,'''services'',coalesce(','''staff'',case when p_desk then coalesce((select jsonb_agg(jsonb_build_object(''id'',s.id,''name'',s.display_name) order by s.display_name) from staff s where s.salon_id=p_salon and s.is_active and s.pos_enabled),''[]''::jsonb) else ''[]''::jsonb end,''services'',coalesce(');
 execute definition;
end $$;

revoke all on function public.staff_scan_available(uuid),public.staff_scan_reconcile(uuid) from public,anon,authenticated;
revoke all on function public.staff_scan_workspace(uuid),public.staff_scan_connect(uuid,uuid),public.staff_scan_save(uuid,uuid,jsonb,boolean,integer),public.staff_scan_cancel(uuid,uuid,integer) from public,anon;
grant execute on function public.staff_scan_workspace(uuid),public.staff_scan_connect(uuid,uuid),public.staff_scan_save(uuid,uuid,jsonb,boolean,integer),public.staff_scan_cancel(uuid,uuid,integer) to authenticated;
revoke all on function public.staff_scan_connect_pass(uuid,uuid) from public,anon;
grant execute on function public.staff_scan_connect_pass(uuid,uuid) to authenticated;
revoke all on function public.staff_scan_desk_save(uuid,uuid,integer,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.staff_scan_desk_save(uuid,uuid,integer,jsonb,uuid,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
