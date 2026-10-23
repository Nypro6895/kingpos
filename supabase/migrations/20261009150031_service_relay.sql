begin;
-- Extend the installed whitelist without dropping other shipped Market plugins.
do $$declare existing_rule text;begin
 select pg_get_expr(conbin,conrelid) into existing_rule from pg_constraint where conrelid='public.salon_market_plugins'::regclass and conname='salon_market_plugins_plugin_id_check';
 if existing_rule is null then raise exception 'Market plugin whitelist needs review'; end if;
 alter table public.salon_market_plugins drop constraint salon_market_plugins_plugin_id_check;
 execute 'alter table public.salon_market_plugins add constraint salon_market_plugins_plugin_id_check check (plugin_id=''service-relay'' or ('||existing_rule||'))';
end $$;

-- The relay stores work in progress. Settlement and turn accounting remain in POS.
create table public.service_relay_tickets (
 visit_id uuid primary key references public.customer_visits(id) on delete cascade,
 salon_id uuid not null references public.locations(id),
 queue_number bigint generated always as identity,
 pass_token uuid not null default gen_random_uuid() unique,
 status text not null default 'waiting' check(status in ('waiting','in_service','checkout','completed','cancelled')),
 revision integer not null default 0,
 pos_ticket_id uuid references public.pos_tickets(id),
 created_at timestamptz not null default now()
);
create table public.service_relay_offers (
 id uuid primary key default gen_random_uuid(),
 visit_id uuid not null references public.service_relay_tickets(visit_id),
 staff_id uuid not null references public.staff(id),
 requested_service_id uuid references public.services(id),
 status text not null default 'offered' check(status in ('offered','working','done','declined','expired')),
 expires_at timestamptz not null default now()+interval '60 seconds',
 created_at timestamptz not null default now()
);
create unique index service_relay_one_active_offer on public.service_relay_offers(visit_id) where status in ('offered','working');
create unique index service_relay_one_active_staff on public.service_relay_offers(staff_id) where status in ('offered','working');
create table public.service_relay_lines (
 id uuid primary key,
 offer_id uuid not null references public.service_relay_offers(id),
 service_id uuid not null references public.services(id),
 amount numeric(12,2) not null check(amount>0),
 revision integer not null default 1
);
alter table public.service_relay_tickets enable row level security;
alter table public.service_relay_offers enable row level security;
alter table public.service_relay_lines enable row level security;
create index service_relay_salon_queue on public.service_relay_tickets(salon_id,status,queue_number);
create index service_relay_visit_service on public.service_relay_offers(visit_id,requested_service_id,status);
create index service_relay_staff_history on public.service_relay_offers(staff_id,status,visit_id);
create index service_relay_offer_lines on public.service_relay_lines(offer_id);

create function public.service_relay_staff(p_salon uuid) returns uuid
language sql stable security definer set search_path=public as $$
 select case when count(*)=1 then (array_agg(id))[1] else null end from staff
 where salon_id=p_salon and is_active and pos_enabled
 and (account_user_id=current_public_user_id() or (account_user_id is null and user_id=auth.uid()))
$$;

-- POS queue projection uses the same amount-part threshold as its receipt core.
-- It is a read projection only; submitted turn parts and earnings are untouched.
create function public.pos_service_relay_pending_turns(p_salon uuid,p_staff uuid) returns bigint
language sql stable security definer set search_path=public as $$
 select count(*) from service_relay_lines l join service_relay_offers o on o.id=l.offer_id
 join service_relay_tickets t on t.visit_id=o.visit_id
 where t.salon_id=p_salon and o.staff_id=p_staff and t.status in ('in_service','checkout')
 and o.status in ('working','done') and l.amount>=coalesce((select large_turn_threshold from pos_settings where salon_id=p_salon),25)
$$;

-- Uses POS's persisted queue count and check-in tie break. Never increments a
-- turn for accepting an offer or completing work; POS owns that calculation.
create function public.pos_dispatch_service_relay(p_salon uuid) returns void
language plpgsql security definer set search_path=public as $$
declare t record; next_service uuid; chosen uuid; day date;
begin
 perform pg_advisory_xact_lock(hashtextextended('service-relay:'||p_salon::text,0));
 if not exists(select 1 from salon_market_plugins where salon_id=p_salon and plugin_id='service-relay') then return; end if;
 day:=get_salon_business_date(p_salon);
 insert into service_relay_tickets(visit_id,salon_id)
 select v.id,v.salon_id from customer_visits v
 where v.salon_id=p_salon and v.status='waiting' and v.ticket_id is null
 and v.checked_in_at>=now()-interval '24 hours'
 on conflict(visit_id) do nothing;
 update service_relay_tickets r set status='waiting',revision=revision+1 from customer_visits v
 where r.salon_id=p_salon and r.visit_id=v.id and r.status='cancelled' and v.status='waiting' and v.ticket_id is null and v.checked_in_at>=now()-interval '24 hours';
 update service_relay_tickets r set status=v.status,pos_ticket_id=coalesce(v.ticket_id,r.pos_ticket_id),revision=revision+1
 from customer_visits v where v.id=r.visit_id and r.salon_id=p_salon
 and v.status in ('cancelled','completed') and r.status<>v.status;
 update service_relay_offers o set status='expired' from service_relay_tickets rt
 where rt.visit_id=o.visit_id and rt.salon_id=p_salon and rt.status in ('cancelled','completed') and o.status in ('offered','working');
 update service_relay_offers o set status='expired' from service_relay_tickets rt
 where rt.visit_id=o.visit_id and rt.salon_id=p_salon and o.status='offered' and o.expires_at<=now();
 for t in select * from service_relay_tickets where salon_id=p_salon and status in ('waiting','in_service') order by queue_number for update loop
  if exists(select 1 from service_relay_offers where visit_id=t.visit_id and status in ('offered','working')) then continue; end if;
  select vs.service_id into next_service from customer_visit_services vs
  where vs.visit_id=t.visit_id and not exists(select 1 from service_relay_offers o where o.visit_id=t.visit_id and o.status='done' and
   (o.requested_service_id=vs.service_id or exists(select 1 from service_relay_lines l where l.offer_id=o.id and l.service_id=vs.service_id)))
  order by vs.sort_order,vs.id limit 1;
  if next_service is null then
   if exists(select 1 from service_relay_offers where visit_id=t.visit_id and status='done') then
    update service_relay_tickets set status='checkout',revision=revision+1 where visit_id=t.visit_id;
    update customer_visits set status='checkout' where id=t.visit_id;
   end if;
   continue;
  end if;
  select s.id into chosen from staff s left join staff_workdays w on w.staff_id=s.id and w.salon_id=p_salon and w.work_date=day
  where s.salon_id=p_salon and s.is_active and s.pos_enabled
  and (s.account_user_id is not null or s.user_id is not null)
  and coalesce(w.status,'not_checked_in') not in ('checked_out','auto_checked_out','unavailable')
  and (not coalesce((select staff_check_in_enabled from pos_settings where salon_id=p_salon),false) or w.status='working')
  and exists(select 1 from staff_service_assignments a where a.staff_id=s.id and a.salon_id=p_salon and a.service_id=next_service and a.is_active
   and (a.effective_start_date is null or a.effective_start_date<=day) and (a.effective_end_date is null or a.effective_end_date>=day))
  and not exists(select 1 from service_relay_offers o where o.staff_id=s.id and o.status in ('offered','working'))
  and not exists(select 1 from service_relay_offers o where o.visit_id=t.visit_id and o.staff_id=s.id and o.requested_service_id=next_service and o.status in ('declined','expired'))
  order by coalesce(w.queue_turn_count,(select count(*) from pos_ticket_item_turn_parts p where p.staff_id=s.id and p.salon_id=p_salon and p.work_date=day and p.turn_type='large'))+pos_service_relay_pending_turns(p_salon,s.id),
   w.check_in_sequence nulls last,s.display_name,s.id limit 1;
  if chosen is not null then insert into service_relay_offers(visit_id,staff_id,requested_service_id) values(t.visit_id,chosen,next_service); end if;
 end loop;
end $$;

create function public.service_relay_payload(p_visit uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('visitId',t.visit_id,'queueNumber',t.queue_number,'customerName',c.name,'status',t.status,'revision',t.revision,
 'requestedServices',customer_visit_requested_services_json(t.visit_id),
 'lines',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'offerId',o.id,'staffId',o.staff_id,'staffName',s.display_name,'serviceId',l.service_id,'serviceName',sv.name,'amount',l.amount) order by o.created_at,l.id)
  from service_relay_lines l join service_relay_offers o on o.id=l.offer_id join staff s on s.id=o.staff_id join services sv on sv.id=l.service_id where o.visit_id=t.visit_id),'[]'::jsonb),
 'offers',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'staffId',o.staff_id,'staffName',s.display_name,'serviceId',o.requested_service_id,'serviceName',coalesce(sv.name,'Service'),'status',o.status,'expiresAt',o.expires_at) order by o.created_at)
  from service_relay_offers o join staff s on s.id=o.staff_id left join services sv on sv.id=o.requested_service_id where o.visit_id=t.visit_id and o.status in ('offered','working','done')),'[]'::jsonb))
 from service_relay_tickets t join customer_visits v on v.id=t.visit_id join customers c on c.id=v.customer_id
 where t.visit_id=p_visit
$$;

create function public.service_relay_workspace(p_salon uuid,p_desk boolean default false,p_key uuid default null,p_signature text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid; desk_allowed boolean;
begin
 if p_desk is null then raise exception 'Not authorized'; end if;
 desk_allowed:=user_has_salon_permission(p_salon,array['tickets.manage']) or
  (pos_portable_access_salon_id(p_key,p_signature)=p_salon and pos_portable_access_has_capability(p_key,p_signature,'portable.pos.use'));
 actor:=service_relay_staff(p_salon);
 if (p_desk and not coalesce(desk_allowed,false)) or (not p_desk and actor is null) then raise exception 'Not authorized'; end if;
 if not exists(select 1 from salon_market_plugins where salon_id=p_salon and plugin_id='service-relay') and not exists(select 1 from service_relay_tickets t where t.salon_id=p_salon and t.status not in ('completed','cancelled') and (p_desk or exists(select 1 from service_relay_offers o where o.visit_id=t.visit_id and o.staff_id=actor and o.status='working'))) then
  return jsonb_build_object('installed',false,'tickets','[]'::jsonb,'services','[]'::jsonb);
 end if;
 perform pos_dispatch_service_relay(p_salon);
 return jsonb_build_object('installed',true,'staffId',actor,
 'tickets',coalesce((select jsonb_agg(service_relay_payload(t.visit_id) order by t.queue_number) from service_relay_tickets t
  where t.salon_id=p_salon and t.status not in ('completed','cancelled') and
  (p_desk or exists(select 1 from service_relay_offers o where o.visit_id=t.visit_id and o.staff_id=actor and o.status in ('offered','working')))),'[]'::jsonb),
 'services',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'price',base_price) order by name) from services where salon_id=p_salon and is_active),'[]'::jsonb));
end $$;

create function public.service_relay_respond(p_salon uuid,p_offer uuid,p_accept boolean) returns void
language plpgsql security definer set search_path=public as $$
declare o service_relay_offers; t service_relay_tickets; actor uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('service-relay:'||p_salon::text,0));
 actor:=service_relay_staff(p_salon);
 if p_accept is null then raise exception 'Choose Accept or Decline'; end if;
 select * into o from service_relay_offers where id=p_offer for update;
 select * into t from service_relay_tickets where visit_id=o.visit_id and salon_id=p_salon for update;
 if actor is null or o.staff_id is distinct from actor or t.visit_id is null then raise exception 'Not authorized'; end if;
 if o.status=(case when p_accept then 'working' else 'declined' end) then return; end if;
 if o.status<>'offered' or o.expires_at<=now() or t.status not in ('waiting','in_service') then raise exception 'This offer has changed. Refresh to see your next customer.'; end if;
 if not exists(select 1 from salon_market_plugins where salon_id=p_salon and plugin_id='service-relay') then raise exception 'Plugin is not installed'; end if;
 if p_accept and coalesce((select staff_check_in_enabled from pos_settings where salon_id=p_salon),false) and not exists(select 1 from staff_workdays where staff_id=actor and salon_id=p_salon and work_date=get_salon_business_date(p_salon) and status='working') then raise exception 'Check in for work first'; end if;
 update service_relay_offers set status=case when p_accept then 'working' else 'declined' end where id=o.id;
 if p_accept then
  update service_relay_tickets set status='in_service',revision=revision+1 where visit_id=t.visit_id;
  update customer_visits set status='in_service' where id=t.visit_id;
 end if;
 perform pos_dispatch_service_relay(p_salon);
end $$;

create function public.service_relay_save(p_salon uuid,p_offer uuid,p_lines jsonb,p_done boolean,p_expected integer) returns void
language plpgsql security definer set search_path=public as $$
declare o service_relay_offers; t service_relay_tickets; line jsonb; actor uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('service-relay:'||p_salon::text,0));
 actor:=service_relay_staff(p_salon);
 select * into o from service_relay_offers where id=p_offer for update;
 select * into t from service_relay_tickets where visit_id=o.visit_id and salon_id=p_salon for update;
 if actor is null or o.staff_id is distinct from actor or t.visit_id is null then raise exception 'Not authorized'; end if;
 if o.status<>'working' or t.status<>'in_service' or p_expected is null or t.revision<>p_expected then raise exception 'Ticket changed. Refresh before saving.'; end if;
 if p_done is null or p_lines is null or jsonb_typeof(p_lines)<>'array' then raise exception 'Add a service and its price.'; end if;
 if jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>30 then raise exception 'Add a service and its price.'; end if;
 for line in select value from jsonb_array_elements(p_lines) loop
  if not exists(select 1 from services where id=(line->>'serviceId')::uuid and salon_id=p_salon and is_active) then raise exception 'Service is not available'; end if;
  if (line->>'amount') is null or (line->>'amount') !~ '^\d+(\.\d{1,2})?$' or (line->>'amount')::numeric<=0 then raise exception 'Enter a positive price with up to two decimals'; end if;
  if exists(select 1 from service_relay_lines where id=(line->>'id')::uuid and offer_id<>o.id) then raise exception 'Line belongs to another staff member'; end if;
 end loop;
 delete from service_relay_lines where offer_id=o.id and id not in(select (value->>'id')::uuid from jsonb_array_elements(p_lines));
 for line in select value from jsonb_array_elements(p_lines) loop
  insert into service_relay_lines(id,offer_id,service_id,amount) values((line->>'id')::uuid,o.id,(line->>'serviceId')::uuid,(line->>'amount')::numeric)
  on conflict(id) do update set service_id=excluded.service_id,amount=excluded.amount,revision=service_relay_lines.revision+1;
 end loop;
 update service_relay_tickets set revision=revision+1 where visit_id=t.visit_id;
 if p_done then update service_relay_offers set status='done' where id=o.id; end if;
 perform pos_dispatch_service_relay(p_salon);
end $$;

-- Cashier confirms collection; the existing receipt core owns all monetary,
-- service turn, commission, payment and staff-record behaviour atomically.
create function public.service_relay_submit(p_salon uuid,p_visit uuid,p_expected integer,p_tip numeric default 0,p_discount numeric default 0,p_key uuid default null,p_signature text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare t service_relay_tickets; v customer_visits; receipt jsonb; result jsonb; portable boolean;
begin
 portable:=coalesce(pos_portable_access_salon_id(p_key,p_signature)=p_salon and pos_portable_access_has_capability(p_key,p_signature,'portable.pos.use'),false);
 if not coalesce(user_has_salon_permission(p_salon,array['tickets.manage']),false) and not portable then raise exception 'Not authorized'; end if;
 perform pg_advisory_xact_lock(hashtextextended('service-relay:'||p_salon::text,0));
 select * into t from service_relay_tickets where visit_id=p_visit and salon_id=p_salon for update;
 if t.visit_id is null then raise exception 'Ticket not found'; end if;
 select * into v from customer_visits where id=p_visit for update;
 if v.status='cancelled' then raise exception 'This check-in was cancelled'; end if;
 if v.status='completed' and v.ticket_id is not null then
  update service_relay_tickets set status='completed',pos_ticket_id=v.ticket_id where visit_id=p_visit;
  return jsonb_build_object('ticketId',v.ticket_id);
 end if;
 if t.status='completed' then return jsonb_build_object('ticketId',t.pos_ticket_id); end if;
 if t.status<>'checkout' or p_expected is null or t.revision<>p_expected then raise exception 'Ticket changed or services are still in progress. Review it before collecting payment.'; end if;
 if p_tip is null or p_discount is null or p_tip<0 or p_discount<0 then raise exception 'Invalid adjustment'; end if;
 select jsonb_build_object('customerId',cv.customer_id,'customerName',c.name,'tipAmount',p_tip,'discountType','fixed_amount','discountValue',p_discount,
  'lines',(select jsonb_agg(jsonb_build_object('id',l.id,'staffId',o.staff_id,'serviceId',l.service_id,'serviceLabel',s.name,'total',l.amount,'amountInput',l.amount::text,'amountParts',jsonb_build_array(l.amount)) order by o.created_at,l.id)
   from service_relay_lines l join service_relay_offers o on o.id=l.offer_id join services s on s.id=l.service_id where o.visit_id=p_visit and o.status='done'))
 into receipt from customer_visits cv join customers c on c.id=cv.customer_id where cv.id=p_visit;
 perform set_config('reylumi.service_relay_visit',p_visit::text,true);
 if portable then result:=submit_pos_portable_receipt(p_key,p_signature,receipt,get_salon_business_date(p_salon));
 else result:=submit_owner_workspace_receipt_core(p_salon,null,receipt,get_salon_business_date(p_salon)); end if;
 perform set_config('reylumi.service_relay_visit','',true);
 perform complete_customer_visit_for_ticket_core(p_salon,(receipt->>'customerId')::uuid,(result->>'ticketId')::uuid,p_visit);
 update service_relay_tickets set status='completed',pos_ticket_id=(result->>'ticketId')::uuid,revision=revision+1 where visit_id=p_visit;
 return result;
end $$;

create function public.service_relay_issue_pass(p_token text,p_visit uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare salon uuid; t service_relay_tickets;
begin
 select d.salon_id into salon from pos_live_drafts d join customer_visits v on v.salon_id=d.salon_id
 where d.token=p_token and d.status='draft' and v.id=p_visit and v.origin_metadata->>'token'=p_token and v.checked_in_at>now()-interval '24 hours';
 if salon is null then raise exception 'Check-in does not belong to this display'; end if;
 if not exists(select 1 from salon_market_plugins where salon_id=salon and plugin_id='service-relay') then return null; end if;
 perform pos_dispatch_service_relay(salon);
 select * into t from service_relay_tickets where visit_id=p_visit;
 return jsonb_build_object('passToken',t.pass_token,'queueNumber',t.queue_number);
end $$;
create function public.service_relay_claim(p_salon uuid,p_code text) returns void
language plpgsql security definer set search_path=public as $$
declare actor uuid; t service_relay_tickets; service uuid; day date;
begin
 perform pg_advisory_xact_lock(hashtextextended('service-relay:'||p_salon::text,0));
 actor:=service_relay_staff(p_salon); day:=get_salon_business_date(p_salon);
 if actor is null or not exists(select 1 from salon_market_plugins where salon_id=p_salon and plugin_id='service-relay') then raise exception 'Not authorized'; end if;
 if p_code ~ '^#?[0-9]+$' then
  select * into t from service_relay_tickets where salon_id=p_salon and queue_number::text=ltrim(p_code,'#') and created_at>now()-interval '24 hours' for update;
 else
  select * into t from service_relay_tickets where salon_id=p_salon and pass_token::text=substring(p_code from '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})') and created_at>now()-interval '24 hours' for update;
 end if;
 if t.visit_id is null or t.status not in ('waiting','in_service','checkout') then raise exception 'Check-in is unavailable in this salon'; end if;
 if exists(select 1 from service_relay_offers where visit_id=t.visit_id and staff_id=actor and status='working') then return; end if;
 if exists(select 1 from service_relay_offers where (visit_id=t.visit_id or staff_id=actor) and status in ('offered','working')) then raise exception 'A customer is already assigned. Respond to that offer first.'; end if;
 select vs.service_id into service from customer_visit_services vs where vs.visit_id=t.visit_id and not exists(select 1 from service_relay_offers o where o.visit_id=t.visit_id and o.requested_service_id=vs.service_id and o.status='done') order by vs.sort_order,vs.id limit 1;
 if service is not null and not exists(select 1 from staff_service_assignments where staff_id=actor and salon_id=p_salon and service_id=service and is_active) then raise exception 'POS has not enabled this service for you'; end if;
 if coalesce((select staff_check_in_enabled from pos_settings where salon_id=p_salon),false) and not exists(select 1 from staff_workdays where salon_id=p_salon and staff_id=actor and work_date=day and status='working') then raise exception 'Check in for work before receiving a customer'; end if;
 insert into service_relay_offers(visit_id,staff_id,requested_service_id,status) values(t.visit_id,actor,service,'working');
 update service_relay_tickets set status='in_service',revision=revision+1 where visit_id=t.visit_id;
 update customer_visits set status='in_service' where id=t.visit_id;
end $$;
create function public.service_relay_public_pass(p_pass uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select service_relay_payload(visit_id)-'lines' from service_relay_tickets where pass_token=p_pass and created_at>now()-interval '24 hours'
$$;

-- All internals are private; public entry points enforce staff/POS identity.
revoke all on function public.service_relay_staff(uuid),public.pos_dispatch_service_relay(uuid),public.service_relay_payload(uuid),public.pos_service_relay_pending_turns(uuid,uuid) from public,anon,authenticated;
revoke all on function public.service_relay_workspace(uuid,boolean,uuid,text),public.service_relay_respond(uuid,uuid,boolean),public.service_relay_save(uuid,uuid,jsonb,boolean,integer),public.service_relay_submit(uuid,uuid,integer,numeric,numeric,uuid,text),public.service_relay_issue_pass(text,uuid),public.service_relay_public_pass(uuid) from public;
grant execute on function public.service_relay_workspace(uuid,boolean,uuid,text),public.service_relay_submit(uuid,uuid,integer,numeric,numeric,uuid,text) to anon,authenticated;
grant execute on function public.service_relay_respond(uuid,uuid,boolean),public.service_relay_save(uuid,uuid,jsonb,boolean,integer) to authenticated;
revoke all on function public.service_relay_claim(uuid,text) from public,anon;
grant execute on function public.service_relay_claim(uuid,text) to authenticated;
grant execute on function public.service_relay_issue_pass(text,uuid),public.service_relay_public_pass(uuid) to anon,authenticated;
commit;
