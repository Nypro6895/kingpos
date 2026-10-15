begin;
create table public.checkin_receipt_subscriptions (
 salon_id uuid primary key references public.locations(id) on delete cascade,
 stripe_subscription text unique, stripe_checkout text, stripe_customer text, payment_owner uuid references public.users(id),
 paid_until timestamptz, updated_at timestamptz not null default now()
);
alter table public.checkin_receipt_subscriptions enable row level security;
grant select on public.checkin_receipt_subscriptions to authenticated;
create policy checkin_receipt_owner_read on public.checkin_receipt_subscriptions for select to authenticated
 using (public.lifecycle_user_is_salon_owner(salon_id, public.current_public_user_id(), false));
create table public.checkin_receipt_counters (
 salon_id uuid references public.locations(id) on delete cascade, business_date date, last_number integer not null,
 primary key(salon_id,business_date)
);
create table public.checkin_receipts (
 visit_id uuid primary key references public.customer_visits(id) on delete cascade,
 salon_id uuid not null references public.locations(id) on delete cascade,
 business_date date not null, queue_number integer not null,
 unique(salon_id,business_date,queue_number)
);
alter table public.checkin_receipt_counters enable row level security;
alter table public.checkin_receipts enable row level security;
-- Customer display may only issue for a waiting visit submitted by its own paired token.
create function public.issue_checkin_receipt(p_token text,p_visit uuid) returns jsonb
 language plpgsql security definer set search_path = public as $$
declare v public.customer_visits; d public.pos_live_drafts; r public.checkin_receipts; day date; n integer;
begin
 select * into d from public.pos_live_drafts where token=p_token and status='draft';
 if d.id is null then raise exception 'Invalid customer display'; end if;
 select * into v from public.customer_visits where id=p_visit and salon_id=d.salon_id for update;
 if v.id is null or v.status <> 'waiting' then raise exception 'Check-in is no longer waiting'; end if;
 if not exists(select 1 from public.checkin_receipt_subscriptions where salon_id=v.salon_id and paid_until>now()) then return null; end if;
 if coalesce(v.origin_metadata->>'token','') <> p_token then raise exception 'Receipt does not belong to this display'; end if;
 day := (v.checked_in_at at time zone coalesce(public.get_salon_business_timezone(v.salon_id),'America/Chicago'))::date;
 select * into r from public.checkin_receipts where visit_id=v.id;
 if r.visit_id is null then
  insert into public.checkin_receipt_counters values(v.salon_id,day,1)
   on conflict(salon_id,business_date) do update set last_number=checkin_receipt_counters.last_number+1 returning last_number into n;
  insert into public.checkin_receipts values(v.id,v.salon_id,day,n) returning * into r;
 end if;
 return jsonb_build_object('visitId',v.id,'queueNumber',r.queue_number,'businessDate',r.business_date,
  'salonName',(select name from public.locations where id=v.salon_id),
  'customerName',(select name from public.customers where id=v.customer_id));
end $$;
revoke all on function public.issue_checkin_receipt(text,uuid) from public;
grant execute on function public.issue_checkin_receipt(text,uuid) to anon,authenticated;
-- Only the server can resolve a scan, after authorizing the POS operator and salon.
create function public.resolve_checkin_receipt(p_salon uuid,p_visit uuid) returns jsonb
 language sql stable security definer set search_path = public as $$
 select jsonb_build_object('id',v.id,'salonId',v.salon_id,'customerId',v.customer_id,
  'customerName',c.name,'customerPhone',c.phone,'checkedInAt',v.checked_in_at,
  'appointmentId',v.appointment_id,'appointmentStartAt',null,'assignedStaffId',null,'assignedStaffName',null,
  'requestedServices',public.customer_visit_requested_services_json(v.id),'serviceLabel',null,
  'source',v.source,'status',v.status,'ticketId',v.ticket_id)
 from public.checkin_receipts r join public.customer_visits v on v.id=r.visit_id and v.salon_id=r.salon_id
 join public.customers c on c.id=v.customer_id and c.location_id=v.salon_id
 where r.salon_id=p_salon and r.visit_id=p_visit and v.status='waiting' and v.ticket_id is null
 and exists(select 1 from public.checkin_receipt_subscriptions s where s.salon_id=p_salon and s.paid_until>now())
$$;
revoke all on function public.resolve_checkin_receipt(uuid,uuid) from public;
grant execute on function public.resolve_checkin_receipt(uuid,uuid) to service_role;
commit;
