begin;

-- Marking an appointment/visit finished is not a payment. Shared visits can
-- leave the unpaid lifecycle only through a valid closed POS receipt or an
-- explicit cancellation. Other salons retain their existing visit behaviour.
create function public.phone_checkin_preserve_unpaid_visit() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.status='completed' and (staff_scan_available(new.salon_id)
  or exists(select 1 from service_relay_tickets t where t.visit_id=new.id))
 and not exists(select 1 from pos_tickets p where p.id=new.ticket_id and p.salon_id=new.salon_id
  and p.customer_id=new.customer_id and p.status='closed') then
  new.status:=case when old.status in ('waiting','in_service','checkout') then old.status else 'checkout' end;
  new.completed_at:=old.completed_at;
 end if;
 return new;
end $$;
revoke all on function public.phone_checkin_preserve_unpaid_visit() from public,anon,authenticated;
create trigger phone_checkin_unpaid_completion before update of status,ticket_id on public.customer_visits
for each row execute function public.phone_checkin_preserve_unpaid_visit();

create or replace function public.staff_scan_reconcile(p_salon uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('service-relay:'||p_salon::text,0));
 with expected as (
  select t.visit_id,paid.id paid_id,case when paid.id is not null then 'completed' when v.status='cancelled' then 'cancelled'
   when exists(select 1 from service_relay_offers x where x.visit_id=v.id and x.status in ('working','offered')) then 'in_service'
   when exists(select 1 from service_relay_lines l join service_relay_offers x on x.id=l.offer_id where x.visit_id=v.id and x.status='done') then 'checkout'
   when v.status in ('in_service','checkout') then v.status else 'waiting' end next_status
  from service_relay_tickets t join customer_visits v on v.id=t.visit_id and v.salon_id=t.salon_id
  left join lateral (select p.id from pos_tickets p where p.id in(v.ticket_id,t.pos_ticket_id)
   and p.salon_id=p_salon and p.customer_id=v.customer_id and p.status='closed'
   order by (p.id=v.ticket_id) desc limit 1) paid on true
  where t.salon_id=p_salon
 ) update service_relay_tickets t set status=e.next_status,pos_ticket_id=e.paid_id,revision=t.revision+1
 from expected e where t.visit_id=e.visit_id and (t.status is distinct from e.next_status or t.pos_ticket_id is distinct from e.paid_id);
 -- Repair an old nonfinancial completion only when it cannot collide with an
 -- independently active arrival for the same customer. Never merge visits.
 update customer_visits v set status=t.status,completed_at=null from service_relay_tickets t
 where t.salon_id=p_salon and t.visit_id=v.id and v.status='completed' and v.ticket_id is null
 and t.status in ('waiting','in_service','checkout') and not exists(select 1 from customer_visits other
  where other.salon_id=v.salon_id and other.customer_id=v.customer_id and other.id<>v.id and other.status in ('waiting','in_service','checkout'));
 update service_relay_offers o set status='expired' from service_relay_tickets t
 where t.salon_id=p_salon and t.visit_id=o.visit_id and t.status in ('completed','cancelled') and o.status in ('offered','working');
end $$;

do $$declare definition text; old_block text;begin
 definition:=pg_get_functiondef('public.pos_dispatch_service_relay(uuid)'::regprocedure);
 old_block:='update service_relay_tickets r set status=v.status,pos_ticket_id=coalesce(v.ticket_id,r.pos_ticket_id),revision=revision+1
 from customer_visits v where v.id=r.visit_id and r.salon_id=p_salon
 and v.status in (''cancelled'',''completed'') and r.status<>v.status;';
 if position(old_block in definition)=0 then raise exception 'Review dispatcher financial completion authority'; end if;
 definition:=replace(definition,old_block,'-- Terminal states are validated by staff_scan_reconcile.');
 definition:=replace(definition,'day:=get_salon_business_date(p_salon);','perform staff_scan_reconcile(p_salon); day:=get_salon_business_date(p_salon);');
 execute definition;
end $$;

-- A check-in is the identity of the shared held ticket, including before a
-- service has a staff member or a price. Every arrival writer uses this table.
-- This trigger only inserts the missing identity; it never starts dispatch,
-- changes attendance, finishes staff work, or writes financial records.
create function public.phone_checkin_ensure_visit_ticket() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.ticket_id is null and new.status in ('waiting','in_service','checkout')
 and staff_scan_available(new.salon_id) then
  insert into service_relay_tickets(visit_id,salon_id,scan_mode,status)
  values(new.id,new.salon_id,true,new.status) on conflict(visit_id) do nothing;
  if new.status='waiting' then
   perform personal_qr_ensure_receipt_for_visit(new.salon_id,new.id);
  end if;
 end if;
 return new;
end $$;
revoke all on function public.phone_checkin_ensure_visit_ticket() from public,anon,authenticated;
create trigger phone_checkin_shared_ticket after insert or update of status,ticket_id on public.customer_visits
for each row execute function public.phone_checkin_ensure_visit_ticket();

-- Existing arrivals keep their identity, lines and offers. No historical or
-- disabled-salon ledgers are fabricated by a subsequent POS/Staff read.
insert into public.service_relay_tickets(visit_id,salon_id,scan_mode,status)
select v.id,v.salon_id,true,v.status from public.customer_visits v
where v.ticket_id is null and v.status in ('waiting','in_service','checkout')
and public.staff_scan_available(v.salon_id) on conflict(visit_id) do nothing;

-- Opening an arrival without priced services must be safe to save and switch.
-- A zero-line draft never becomes a payment or a completed staff service.
do $$declare definition text; old_status text; new_status text;begin
 definition:=pg_get_functiondef('public.staff_scan_desk_save(uuid,uuid,integer,jsonb,uuid,text)'::regprocedure);
 if position('jsonb_array_length(p_lines) not between 1 and 30' in definition)=0 then raise exception 'Review empty held-ticket draft validation'; end if;
 definition:=replace(definition,'jsonb_array_length(p_lines) not between 1 and 30','jsonb_array_length(p_lines) not between 0 and 30');
 old_status:='case when exists(select 1 from service_relay_offers where visit_id=p_visit and status=''working'') then ''in_service'' else ''checkout'' end';
 new_status:='case when exists(select 1 from service_relay_offers where visit_id=p_visit and status in (''working'',''offered'')) then ''in_service'' when exists(select 1 from service_relay_lines l join service_relay_offers x on x.id=l.offer_id where x.visit_id=p_visit and x.status=''done'') then ''checkout'' else ''waiting'' end';
 if position(old_status in definition)=0 then raise exception 'Review held-ticket saved status projection'; end if;
 execute replace(definition,old_status,new_status);
 definition:=pg_get_functiondef('public.phone_checkin_update_pos_ticket(uuid,uuid,integer,jsonb,numeric,numeric,boolean,uuid,text)'::regprocedure);
 if position('perform staff_scan_desk_save' in definition)=0 then raise exception 'Review held-ticket final validation'; end if;
 definition:=replace(definition,'perform staff_scan_desk_save',
  'if p_finalize is true and (p_lines is null or jsonb_typeof(p_lines)<>''array'' or jsonb_array_length(p_lines)=0) then raise exception ''Add a service and amount before Submit''; end if; perform staff_scan_desk_save');
 execute definition;
end $$;

-- Read-only reconciliation works after the last open ticket disappears and
-- after plugin expiry. Absence and lack of authorization are explicit errors.
create function public.phone_checkin_visit_state(p_salon uuid,p_visit uuid,p_key uuid default null,p_signature text default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v customer_visits; t service_relay_tickets; paid uuid; state text;
begin
 if not coalesce(user_has_salon_permission(p_salon,array['tickets.manage']),false)
 and not coalesce(pos_portable_access_salon_id(p_key,p_signature)=p_salon and pos_portable_access_has_capability(p_key,p_signature,'portable.pos.use'),false) then raise exception 'Not authorized'; end if;
 select * into v from customer_visits where id=p_visit and salon_id=p_salon;
 if v.id is null then raise exception 'This check-in is unavailable in this salon'; end if;
 select * into t from service_relay_tickets where visit_id=v.id and salon_id=p_salon;
 select p.id into paid from pos_tickets p where p.id in (v.ticket_id,t.pos_ticket_id)
 and p.salon_id=p_salon and p.customer_id=v.customer_id and p.status='closed'
 order by (p.id=v.ticket_id) desc limit 1;
 state:=case when paid is not null then 'completed' when v.status='cancelled' then 'cancelled'
  when v.status='completed' then 'checkout' else v.status end;
 return jsonb_build_object('visitId',v.id,'status',state,'ticketId',paid,'revision',t.revision,
  'completed',paid is not null,'cancelled',paid is null and v.status='cancelled');
end $$;
revoke all on function public.phone_checkin_visit_state(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.phone_checkin_visit_state(uuid,uuid,uuid,text) to anon,authenticated;

-- Today is an operational projection of actual visits, not booking totals or
-- provisional receipt amounts. Each visit occupies exactly one state bucket.
create function public.phone_checkin_operations(p_salon uuid,p_date date default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare day date:=coalesce(p_date,get_salon_business_date(p_salon)); zone text:=get_salon_business_timezone(p_salon);
 current_day boolean; totals jsonb; people jsonb; staff_totals jsonb; enabled boolean;
begin
 if not coalesce(user_has_salon_permission(p_salon,array['tickets.view','tickets.manage','staff.view','reports.view']),false)
 and service_relay_staff(p_salon) is null then raise exception 'Not authorized'; end if;
 current_day:=day=get_salon_business_date(p_salon);
 enabled:=staff_scan_available(p_salon) or exists(select 1 from service_relay_tickets t where t.salon_id=p_salon and t.status not in ('completed','cancelled'));
 with visits as (
  select v.*,exists(select 1 from pos_tickets p where p.id in (v.ticket_id,t.pos_ticket_id)
   and p.salon_id=p_salon and p.customer_id=v.customer_id and p.status='closed') paid,
   exists(select 1 from service_relay_offers o where o.visit_id=v.id and o.status='working') working,
   exists(select 1 from service_relay_lines l join service_relay_offers o on o.id=l.offer_id where o.visit_id=v.id and o.status='done') priced_done
  from customer_visits v left join service_relay_tickets t on t.visit_id=v.id and t.salon_id=p_salon
  where v.salon_id=p_salon and v.checked_in_at>=day::timestamp at time zone zone
   and v.checked_in_at<(day+1)::timestamp at time zone zone
 ), states as (
  select case when paid then 'submitted' when status='cancelled' then 'cancelled'
   when working then 'inService' when priced_done or status in ('checkout','completed') then 'readyToPay'
   when status='in_service' then 'inService' else 'waiting' end state from visits
 ) select jsonb_build_object('checkedIn',count(*),'waiting',count(*) filter(where state='waiting'),
  'inService',count(*) filter(where state='inService'),'readyToPay',count(*) filter(where state='readyToPay'),
  'submitted',count(*) filter(where state='submitted'),'cancelled',count(*) filter(where state='cancelled')) into totals from states;
 if current_day then
  with people_state as (
   select s.id,case when exists(select 1 from staff_workdays w where w.salon_id=p_salon and w.staff_id=s.id and w.work_date=day
     and w.status in ('checked_out','auto_checked_out','unavailable','break'))
    or (coalesce((select staff_check_in_enabled from pos_settings where salon_id=p_salon),false)
     and not exists(select 1 from staff_workdays w where w.salon_id=p_salon and w.staff_id=s.id and w.work_date=day and w.status in ('working','checked_in'))) then 'offDuty'
    when exists(select 1 from service_relay_offers o
    join customer_visits v on v.id=o.visit_id join service_relay_tickets t on t.visit_id=v.id
    where o.staff_id=s.id and o.status='working' and t.salon_id=p_salon and v.salon_id=p_salon
     and v.status<>'cancelled' and not exists(select 1 from pos_tickets p where p.id in(v.ticket_id,t.pos_ticket_id)
      and p.salon_id=p_salon and p.customer_id=v.customer_id and p.status='closed')) then 'busy'
    else 'available' end state,
    coalesce((select jsonb_agg(o.visit_id order by o.created_at) from service_relay_offers o
     join customer_visits v on v.id=o.visit_id join service_relay_tickets t on t.visit_id=v.id
     where o.staff_id=s.id and o.status='working' and t.salon_id=p_salon and v.salon_id=p_salon and v.status<>'cancelled'
     and not exists(select 1 from pos_tickets p where p.id in(v.ticket_id,t.pos_ticket_id)
      and p.salon_id=p_salon and p.customer_id=v.customer_id and p.status='closed')),'[]'::jsonb) visit_ids
   from staff s where s.salon_id=p_salon and s.is_active and s.pos_enabled
  ) select coalesce(jsonb_agg(jsonb_build_object('staffId',id,'state',state,'visitIds',visit_ids) order by id),'[]'::jsonb),
   jsonb_build_object('busy',count(*) filter(where state='busy'),'available',count(*) filter(where state='available'),
    'offDuty',count(*) filter(where state='offDuty')) into people,staff_totals from people_state;
 else people:='[]'::jsonb;staff_totals:=null;end if;
 return jsonb_build_object('enabled',enabled,'businessDate',day,'currentDay',current_day,'counts',totals,'staff',staff_totals,'staffStates',people);
end $$;
revoke all on function public.phone_checkin_operations(uuid,date) from public,anon,authenticated;
grant execute on function public.phone_checkin_operations(uuid,date) to authenticated;
notify pgrst,'reload schema';
commit;
