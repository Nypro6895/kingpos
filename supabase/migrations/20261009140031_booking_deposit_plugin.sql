begin;
alter table public.market_payment_settings add column booking_deposit_test_enabled boolean not null default true;
create table public.booking_deposit_subscriptions (
 salon_id uuid primary key references public.locations(id) on delete cascade,
 enabled boolean not null default false,
 installed boolean not null default false,
 mode text not null default 'fixed' check(mode in ('fixed','percent','full')),
 value numeric(10,2) not null default 20 check(value>0 and value<=999999 and (mode<>'percent' or value<=100)),
 checkout text not null default 'both' check(checkout in ('both','embedded','hosted')),
 stripe_account text unique check(stripe_account ~ '^acct_[a-zA-Z0-9]+$'),
 paid_until timestamptz, stripe_subscription text unique, stripe_checkout text,
 checkout_reference uuid not null default gen_random_uuid(), stripe_customer text,
 payment_owner uuid references public.users(id), updated_at timestamptz not null default now()
);
create table public.booking_deposit_orders (
 id uuid primary key default gen_random_uuid(),
 token uuid not null unique default gen_random_uuid(),
 salon_id uuid not null references public.locations(id),
 actor_id uuid references public.users(id),
 request_key text not null, request_hash text not null,
 args jsonb not null, total_cents integer not null check(total_cents>=0),
 amount_cents integer not null check(amount_cents>=50 and amount_cents<=total_cents),
 mode text not null check(mode in ('fixed','percent','full')),
 checkout text not null check(checkout in ('embedded','hosted')),
 is_test boolean not null default false,
 stripe_account text not null, stripe_session text unique, stripe_intent text unique,
 status text not null default 'pending' check(status in ('pending','paid','refund_pending','refunded','expired','test_completed')),
 receipt_url text, refunded_cents integer not null default 0 check(refunded_cents>=0 and refunded_cents<=amount_cents),
 booking_id uuid unique references public.bookings(id), result jsonb,
 created_at timestamptz not null default now(), paid_at timestamptz,
 unique(salon_id,request_key)
);
alter table public.booking_deposit_subscriptions enable row level security;
alter table public.booking_deposit_orders enable row level security;
revoke all on public.booking_deposit_subscriptions,public.booking_deposit_orders from public,anon,authenticated;
grant all on public.booking_deposit_subscriptions,public.booking_deposit_orders to service_role;
alter table public.bookings add column deposit_paid_cents integer not null default 0,
 add column deposit_refunded_cents integer not null default 0,
 add column deposit_receipt_url text;
alter table public.bookings add constraint booking_deposit_amounts_valid check(deposit_paid_cents>=0 and deposit_refunded_cents>=0 and deposit_refunded_cents<=deposit_paid_cents);

create function public.booking_deposit_save(p_salon uuid,p_enabled boolean,p_mode text,p_value numeric,p_checkout text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,public.current_public_user_id(),false),false)
 or not exists(select 1 from public.locations where id=p_salon and status='active') then raise exception 'Active salon owner access required.'; end if;
 if p_enabled and not exists(select 1 from booking_deposit_subscriptions where salon_id=p_salon and installed and ((select booking_deposit_test_enabled from market_payment_settings where id=true) or (paid_until>now() and stripe_account is not null))) then raise exception 'Add the plugin, or subscribe and connect Stripe for live payments.'; end if;
 insert into booking_deposit_subscriptions(salon_id,enabled,mode,value,checkout) values(p_salon,p_enabled,p_mode,p_value,p_checkout)
 on conflict(salon_id) do update set enabled=p_enabled,mode=p_mode,value=p_value,checkout=p_checkout,updated_at=now();
end $$;
create function public.public_booking_deposit(p_salon uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('enabled',true,'mode',mode,'value',value,'checkout',checkout,'testMode',m.booking_deposit_test_enabled)
 from booking_deposit_subscriptions p join locations l on l.id=p.salon_id
 cross join market_payment_settings m
 where salon_id=p_salon and p.installed and p.enabled and m.id=true and (m.booking_deposit_test_enabled or (paid_until>now() and stripe_account is not null)) and l.status='active';
$$;
create function public.booking_deposit_install(p_salon uuid,p_installed boolean) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,public.current_public_user_id(),false),false)
 or not exists(select 1 from locations where id=p_salon and status='active') then raise exception 'Active salon owner access required.'; end if;
 insert into booking_deposit_subscriptions(salon_id,installed) values(p_salon,p_installed)
 on conflict(salon_id) do update set installed=p_installed,enabled=case when p_installed then booking_deposit_subscriptions.enabled else false end,updated_at=now();
end $$;
revoke all on function public.booking_deposit_install(uuid,boolean) from public,anon,authenticated;
grant execute on function public.booking_deposit_install(uuid,boolean) to authenticated;
revoke all on function public.booking_deposit_save(uuid,boolean,text,numeric,text), public.public_booking_deposit(uuid) from public,anon,authenticated;
grant execute on function public.booking_deposit_save(uuid,boolean,text,numeric,text) to authenticated;
grant execute on function public.public_booking_deposit(uuid) to anon,authenticated;

-- Keep all existing scheduling, identity and notification logic. Block direct RPC bypasses.
alter function public.create_public_booking(uuid,text,text,text,text,timestamptz,timestamptz,jsonb,text,text,text,uuid,text) rename to create_public_booking_without_deposit;
revoke all on function public.create_public_booking_without_deposit(uuid,text,text,text,text,timestamptz,timestamptz,jsonb,text,text,text,uuid,text) from public,anon,authenticated;
create function public.create_public_booking(
 p_salon_id uuid,p_customer_first_name text,p_customer_last_name text,p_customer_phone text,p_customer_email text,
 p_start_at timestamptz,p_end_at timestamptz,p_lines jsonb,p_public_notes text default null,p_source text default 'public_profile',
 p_source_reference_type text default null,p_source_reference_id uuid default null,p_idempotency_key text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if public.public_booking_deposit(p_salon_id) is not null then raise exception 'Payment required before confirming this booking.'; end if;
 return public.create_public_booking_without_deposit(p_salon_id,p_customer_first_name,p_customer_last_name,p_customer_phone,p_customer_email,p_start_at,p_end_at,p_lines,p_public_notes,p_source,p_source_reference_type,p_source_reference_id,p_idempotency_key);
end $$;
revoke all on function public.create_public_booking(uuid,text,text,text,text,timestamptz,timestamptz,jsonb,text,text,text,uuid,text) from public;
grant execute on function public.create_public_booking(uuid,text,text,text,text,timestamptz,timestamptz,jsonb,text,text,text,uuid,text) to anon,authenticated;

create function public.booking_deposit_record_payment(p_order uuid,p_intent text,p_refunded integer,p_receipt text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare o public.booking_deposit_orders%rowtype; refunded integer;
begin
 select * into o from booking_deposit_orders where id=p_order for update;
 if o.is_test then raise exception 'Test transactions cannot record real payments.'; end if;
 if o.id is null or p_intent is null or p_refunded is null or p_intent !~ '^pi_[a-zA-Z0-9]+$' or p_refunded<0 or p_refunded>o.amount_cents
 or (o.stripe_intent is not null and o.stripe_intent<>p_intent) then raise exception 'Invalid payment receipt.'; end if;
 refunded:=greatest(o.refunded_cents,p_refunded);
 update booking_deposit_orders set stripe_intent=p_intent,paid_at=coalesce(paid_at,now()),receipt_url=coalesce(p_receipt,receipt_url),refunded_cents=refunded,
 status=case when refunded=amount_cents then 'refunded' when status in ('pending','expired') then 'paid' else status end where id=p_order;
 if o.booking_id is not null then
  update bookings set deposit_refunded_cents=refunded,deposit_receipt_url=coalesce(p_receipt,deposit_receipt_url),payment_status=case when refunded=o.amount_cents then 'refunded' else 'paid' end where id=o.booking_id;
 end if;
 return jsonb_build_object('booking_id',o.booking_id,'refunded_cents',refunded);
end $$;
revoke all on function public.booking_deposit_record_payment(uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.booking_deposit_record_payment(uuid,text,integer,text) to service_role;

create function public.booking_deposit_finalize(p_order uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare o public.booking_deposit_orders%rowtype; a jsonb; r jsonb; b uuid;
begin
 select * into o from booking_deposit_orders where id=p_order for update;
 if o.result is not null then return o.result; end if;
 if o.is_test and public.public_booking_deposit(o.salon_id)->>'testMode' is distinct from 'true' then raise exception 'Test checkout is no longer enabled.'; end if;
 if o.status='refund_pending' then return jsonb_build_object('refund',true); end if;
 if o.refunded_cents>0 and o.refunded_cents<o.amount_cents and o.result is null then
  update booking_deposit_orders set status='refund_pending' where id=o.id;
  return jsonb_build_object('refund',true);
 end if;
 if o.id is null or (not o.is_test and (o.status<>'paid' or o.stripe_intent is null)) or (o.is_test and o.status<>'pending') then raise exception 'Verified payment required.'; end if;
 if o.result is not null then return o.result; end if;
 a:=o.args;
 -- Restore the verified customer identity for the existing function and its notification triggers.
 perform set_config('request.jwt.claim.sub',coalesce((select auth_user_id::text from users where id=o.actor_id),''),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select auth_user_id from users where id=o.actor_id))::text,true);
 begin
 r:=public.create_public_booking_without_deposit(o.salon_id,a->>'p_customer_first_name',a->>'p_customer_last_name',a->>'p_customer_phone',a->>'p_customer_email',
 (a->>'p_start_at')::timestamptz,(a->>'p_end_at')::timestamptz,a->'p_lines',a->>'p_public_notes',a->>'p_source',a->>'p_source_reference_type',nullif(a->>'p_source_reference_id','')::uuid,a->>'p_idempotency_key');
 if not coalesce((r->>'ok')::boolean,false) then raise exception 'Booking could not be created.'; end if;
 exception when raise_exception or exclusion_violation or check_violation then
   if o.is_test then raise; end if;
   update booking_deposit_orders set status='refund_pending' where id=o.id;
   return jsonb_build_object('refund',true);
 end;
 b:=(r->>'booking_id')::uuid;
 -- Use the immutable price shown at checkout even if the catalog changes during payment.
 update booking_lines l set unit_price=(q.value->>'unit_price')::numeric,
 line_total=(q.value->>'unit_price')::numeric*l.quantity
 from jsonb_array_elements(a->'p_lines') q
 where l.booking_id=b and l.display_order=(q.value->>'display_order')::integer and q.value ? 'unit_price';
 update bookings set payment_status=case when o.is_test then 'not_required' else 'paid' end,deposit_paid_cents=case when o.is_test then 0 else o.amount_cents end,deposit_receipt_url=o.receipt_url,
 deposit_policy_snapshot=jsonb_build_object('mode',o.mode,'total_cents',o.total_cents,'amount_cents',o.amount_cents,'currency','usd','test',o.is_test) where id=b;
 update booking_deposit_orders set booking_id=b,result=r,status=case when o.is_test then 'test_completed' else status end where id=o.id;
 return r;
end $$;
revoke all on function public.booking_deposit_finalize(uuid) from public,anon,authenticated;
grant execute on function public.booking_deposit_finalize(uuid) to service_role;
notify pgrst,'reload schema';
commit;
