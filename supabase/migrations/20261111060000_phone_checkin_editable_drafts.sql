begin;

-- A staff Done is a handoff, never a settlement. Reuse its offer and lines so
-- editing does not add another provisional turn. POS remains the only finalizer.
create or replace function public.staff_scan_save(p_salon uuid,p_offer uuid,p_lines jsonb,p_done boolean,p_expected integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid; t service_relay_tickets; o service_relay_offers; line jsonb; next_status text;
begin
 actor:=service_relay_staff(p_salon);
 perform staff_scan_reconcile(p_salon);
 select * into o from service_relay_offers where id=p_offer for update;
 select * into t from service_relay_tickets where visit_id=o.visit_id and salon_id=p_salon for update;
 if actor is null or o.staff_id is distinct from actor or t.visit_id is null or not t.scan_mode then raise exception 'Not authorized'; end if;
 if t.status in ('completed','cancelled') then raise exception 'POS has saved or closed this ticket. Open Your tickets.'; end if;
 if p_done is null or p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)>30
 or (p_done and jsonb_array_length(p_lines)=0) then raise exception 'Choose a service and enter its amount'; end if;
 -- An exact retry of Done is safe even after a lost response; stale changed
 -- values must go through the version check and can never overwrite POS edits.
 if o.status='done' and p_done and exists(select 1 from service_relay_lines where offer_id=o.id)
 and not exists(
  (select l.id::text,l.service_id::text,l.amount from service_relay_lines l where l.offer_id=o.id
   except select x->>'id',x->>'serviceId',(x->>'amount')::numeric from jsonb_array_elements(p_lines) x)
  union all
  (select x->>'id',x->>'serviceId',(x->>'amount')::numeric from jsonb_array_elements(p_lines) x
   except select l.id::text,l.service_id::text,l.amount from service_relay_lines l where l.offer_id=o.id)
 ) then return service_relay_payload(t.visit_id); end if;
 if o.status not in ('working','done') or t.revision is distinct from p_expected then raise exception 'POS changed this work. Refresh before editing.'; end if;
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
 update service_relay_offers set status=case when jsonb_array_length(p_lines)=0 then 'declined' when p_done then 'done' else o.status end where id=o.id;
 next_status:=case
  when exists(select 1 from service_relay_offers where visit_id=t.visit_id and status in ('working','offered')) then 'in_service'
  when exists(select 1 from service_relay_lines l join service_relay_offers x on x.id=l.offer_id where x.visit_id=t.visit_id and x.status='done') then 'checkout'
  else 'waiting' end;
 update service_relay_tickets set revision=revision+1,status=next_status where visit_id=t.visit_id;
 update customer_visits set status=next_status where id=t.visit_id;
 return service_relay_payload(t.visit_id);
end $$;

alter table public.service_relay_tickets add column draft_tip numeric(12,2) not null default 0 check(draft_tip>=0);
alter table public.service_relay_tickets add column draft_discount numeric(12,2) not null default 0 check(draft_discount>=0);
create table public.phone_checkin_draft_requests(
 salon_id uuid not null references public.locations(id),
 request_id uuid not null,
 visit_id uuid not null references public.customer_visits(id),
 payload jsonb not null,
 primary key(salon_id,request_id)
);
alter table public.phone_checkin_draft_requests enable row level security;
revoke all on public.phone_checkin_draft_requests from public,anon,authenticated;

-- This is the same existing customer visit, not a second local receipt. A lost
-- response reuses the request, while a visit already edited by staff is opened
-- from held tickets instead of being overwritten from a stale POS cart.
create function public.phone_checkin_hold_pos_draft(p_salon uuid,p_request uuid,p_customer uuid,p_lines jsonb,p_visit uuid default null,p_tip numeric default 0,p_discount numeric default 0,p_key uuid default null,p_signature text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare visit uuid; t service_relay_tickets; matches integer; draft_payload jsonb;
begin
 if not coalesce(user_has_salon_permission(p_salon,array['tickets.manage']),false)
 and not coalesce(pos_portable_access_salon_id(p_key,p_signature)=p_salon and pos_portable_access_has_capability(p_key,p_signature,'portable.pos.use'),false) then raise exception 'Not authorized'; end if;
 if not staff_scan_available(p_salon) then return null; end if;
 if p_request is null or p_customer is null or not exists(select 1 from customers where id=p_customer and location_id=p_salon) then raise exception 'Select a customer before sharing this ticket with staff'; end if;
 if p_tip is null or p_discount is null or p_tip<0 or p_discount<0 then raise exception 'Invalid adjustment'; end if;
 perform staff_scan_reconcile(p_salon);
 draft_payload:=jsonb_build_object('customer',p_customer,'lines',p_lines,'tip',p_tip,'discount',p_discount);
 select visit_id into visit from phone_checkin_draft_requests where salon_id=p_salon and request_id=p_request;
 if visit is not null then
  select * into t from service_relay_tickets where visit_id=visit and salon_id=p_salon for update;
  if t.status in ('completed','cancelled') then raise exception 'POS has saved or closed this ticket. Open Your tickets.'; end if;
  if not exists(select 1 from phone_checkin_draft_requests r where r.salon_id=p_salon and r.request_id=p_request and r.payload=draft_payload) then raise exception 'This customer already has a held ticket. Open Saved tickets to edit it.'; end if;
  return service_relay_payload(visit);
 end if;
 if p_visit is not null then
  select id into visit from customer_visits where id=p_visit and salon_id=p_salon and customer_id=p_customer and ticket_id is null and status in ('waiting','in_service','checkout') for update;
  if visit is null then raise exception 'This check-in is no longer available'; end if;
 else
  select count(*), (array_agg(id))[1] into matches,visit from customer_visits where salon_id=p_salon and customer_id=p_customer and ticket_id is null and status in ('waiting','in_service','checkout');
  if matches>1 then raise exception 'Select the correct customer check-in before saving'; end if;
  if visit is null then
   insert into customer_visits(id,salon_id,customer_id,source) values(gen_random_uuid(),p_salon,p_customer,'walk_in') returning id into visit;
  end if;
 end if;
 insert into service_relay_tickets(visit_id,salon_id,scan_mode) values(visit,p_salon,true) on conflict(visit_id) do nothing;
 select * into t from service_relay_tickets where visit_id=visit and salon_id=p_salon for update;
 if t.status in ('completed','cancelled') then raise exception 'This check-in is no longer available'; end if;
 if exists(select 1 from service_relay_lines l join service_relay_offers o on o.id=l.offer_id where o.visit_id=visit)
 or exists(select 1 from service_relay_offers where visit_id=visit and status in ('working','done')) then raise exception 'This customer already has a held ticket. Open Saved tickets to edit it.'; end if;
 perform staff_scan_desk_save(p_salon,visit,t.revision,p_lines,p_key,p_signature);
 update service_relay_tickets set draft_tip=p_tip,draft_discount=p_discount where visit_id=visit;
 insert into phone_checkin_draft_requests values(p_salon,p_request,visit,draft_payload);
 return service_relay_payload(visit);
end $$;
revoke all on function public.phone_checkin_hold_pos_draft(uuid,uuid,uuid,jsonb,uuid,numeric,numeric,uuid,text) from public,anon,authenticated;
grant execute on function public.phone_checkin_hold_pos_draft(uuid,uuid,uuid,jsonb,uuid,numeric,numeric,uuid,text) to anon,authenticated;

do $$declare definition text;begin
 definition:=pg_get_functiondef('public.service_relay_payload(uuid)'::regprocedure);
 if position('''revision'',t.revision,' in definition)=0 then raise exception 'Review relay payload before installing draft adjustments'; end if;
 definition:=replace(definition,'''revision'',t.revision,','''revision'',t.revision,''draftTip'',t.draft_tip,''draftDiscount'',t.draft_discount,');
 execute definition;
end $$;

-- Re-scanning finished work also moves older phone-dispatched tickets into the
-- same Scan editor, without reopening the offer or creating another turn.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.staff_scan_connect(uuid,uuid)'::regprocedure);
 if position('status=''done'') then' in definition)=0 then raise exception 'Review Scan connection before installing draft handoff'; end if;
 definition:=replace(definition,'return service_relay_payload(p_visit);',
  'update service_relay_tickets set scan_mode=true where visit_id=p_visit; return service_relay_payload(p_visit);');
 execute definition;
 definition:=pg_get_functiondef('public.service_relay_workspace(uuid,boolean,uuid,text)'::regprocedure);
 if position('o.status in (''offered'',''working'')' in definition)=0 then raise exception 'Review relay workspace before installing draft handoff'; end if;
 definition:=replace(definition,'o.status in (''offered'',''working'')','o.status in (''offered'',''working'',''done'')');
 execute definition;
 definition:=pg_get_functiondef('public.guard_pos_service_relay_ticket()'::regprocedure);
 definition:=replace(definition,'Open Service tickets in POS to Submit.','Open Saved tickets in POS to Submit.');
 execute definition;
end $$;

notify pgrst,'reload schema';
commit;
