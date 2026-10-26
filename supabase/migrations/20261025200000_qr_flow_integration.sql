begin;

-- Personal and kiosk check-ins must share the installed per-salon daily receipt
-- counter. Never use the relay's global identity as the receipt number.
-- The public display wrapper keeps its pairing/origin checks. The private
-- issuance core also supports an account-owned visit first created at the desk.
create function public.personal_qr_ensure_receipt_for_visit(p_salon uuid,p_visit uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v customer_visits; r checkin_receipts; day date; n integer;
begin
 select * into v from customer_visits where id=p_visit and salon_id=p_salon for update;
 if v.id is null or v.status<>'waiting' then raise exception 'Check-in is no longer waiting'; end if;
 if not exists(select 1 from checkin_receipt_subscriptions where salon_id=p_salon and paid_until>now()) then return null; end if;
 day:=(v.checked_in_at at time zone coalesce(get_salon_business_timezone(p_salon),'America/Chicago'))::date;
 select * into r from checkin_receipts where visit_id=v.id;
 if r.visit_id is null then
  insert into checkin_receipt_counters values(p_salon,day,1)
   on conflict(salon_id,business_date) do update set last_number=checkin_receipt_counters.last_number+1 returning last_number into n;
  insert into checkin_receipts values(v.id,p_salon,day,n) returning * into r;
 end if;
 return jsonb_build_object('visitId',v.id,'queueNumber',r.queue_number,'businessDate',r.business_date,
  'salonName',(select name from locations where id=p_salon),'customerName',(select name from customers where id=v.customer_id));
end $$;
revoke all on function public.personal_qr_ensure_receipt_for_visit(uuid,uuid) from public,anon,authenticated;

create or replace function public.issue_checkin_receipt(p_token text,p_visit uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v customer_visits; d pos_live_drafts;
begin
 select * into d from pos_live_drafts where token=p_token and status='draft';
 if d.id is null then raise exception 'Invalid customer display'; end if;
 select * into v from customer_visits where id=p_visit and salon_id=d.salon_id for update;
 if v.id is null or v.status<>'waiting' then raise exception 'Check-in is no longer waiting'; end if;
 if not exists(select 1 from checkin_receipt_subscriptions where salon_id=v.salon_id and paid_until>now()) then return null; end if;
 if coalesce(v.origin_metadata->>'token','')<>p_token then raise exception 'Receipt does not belong to this display'; end if;
 return personal_qr_ensure_receipt_for_visit(d.salon_id,v.id);
end $$;

do $$declare definition text; marker text:=' insert into service_relay_tickets(visit_id,salon_id,scan_mode)';begin
 definition:=pg_get_functiondef('public.personal_qr_checkin(uuid,uuid[],uuid)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'Review Personal check-in before integrating receipt numbering'; end if;
 definition:=replace(definition,marker,
  ' if visit.status=''waiting'' then perform personal_qr_ensure_receipt_for_visit(target_salon,visit.id); end if;'||chr(10)||marker);
 definition:=replace(definition,'not between 1 and 30','not between 1 and 8');
 definition:=replace(definition,'''Choose your services''','''Choose up to 8 services''');
 execute definition;
end $$;

-- Ready is a call for one waiting period. Once work begins it cannot reappear
-- when an empty Holding is cancelled. Retain its request identity for retries.
alter table public.personal_qr_ready add column consumed_at timestamptz;

create function public.personal_qr_consume_ready() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 update personal_qr_ready set consumed_at=coalesce(consumed_at,now()) where visit_id=new.id;
 return new;
end $$;
revoke all on function public.personal_qr_consume_ready() from public,anon,authenticated;
create trigger personal_qr_consume_ready after update of status on public.customer_visits
for each row when (new.status is distinct from old.status and new.status<>'waiting')
execute function public.personal_qr_consume_ready();

do $$declare definition text;begin
 definition:=pg_get_functiondef('public.personal_qr_visit(uuid)'::regprocedure);
 if position('where n.visit_id=v.id)' in definition)=0 then raise exception 'Review Personal Ready projection'; end if;
 definition:=replace(definition,'where n.visit_id=v.id)','where n.visit_id=v.id and n.consumed_at is null)');
 execute definition;
 definition:=pg_get_functiondef('public.personal_qr_notify_ready(uuid,uuid,uuid,text,uuid,uuid,text)'::regprocedure);
 if position('(prior.notified_at>now()' in definition)=0 or position('notified_at=now();' in definition)=0 then raise exception 'Review Ready retry handling'; end if;
 definition:=replace(definition,'(prior.notified_at>now()','(prior.consumed_at is null and prior.notified_at>now()');
 definition:=replace(definition,'notified_at=now();','notified_at=now(),consumed_at=null;');
 execute definition;
end $$;

-- Do not revive a Ready emitted before any already-connected historical work.
update public.personal_qr_ready n set consumed_at=now()
where exists(select 1 from public.service_relay_offers o where o.visit_id=n.visit_id and o.created_at>=n.notified_at and o.status in ('working','done','declined'));

notify pgrst,'reload schema';
commit;
