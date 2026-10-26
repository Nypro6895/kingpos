begin;
create table public.platform_payment_settings (
 id boolean primary key default true check(id), encrypted_config text not null,
 public_config jsonb not null default '{}', version integer not null default 1,
 updated_at timestamptz not null default now()
);
create table public.market_card_purchases (
 id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.locations(id),
 payer_id uuid not null references public.users(id), plugin_id text not null references public.market_billing_catalog(plugin_id),
 snapshot jsonb not null, amount_cents integer not null check(amount_cents between 50 and 100000000),
 status text not null default 'creating', session_id text unique, subscription_id text unique, customer_id text,
 paid_until timestamptz, synced_at timestamptz, last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index market_card_one_open on public.market_card_purchases(salon_id,plugin_id)
 where status not in ('expired','canceled','refunded');
create table public.market_card_invoices (
 id text primary key, purchase_id uuid not null references public.market_card_purchases(id),
 amount_cents integer not null, refunded_cents integer not null default 0, payment_intent text,
 status text not null, period_end timestamptz, updated_at timestamptz not null default now()
);
create table public.market_card_events (
 id text primary key, type text not null, object_id text, status text not null default 'pending',
 attempts integer not null default 0, last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.market_system_audit (
 id uuid primary key default gen_random_uuid(), actor_id uuid references public.users(id), action text not null,
 details jsonb not null default '{}', created_at timestamptz not null default now()
);
alter table public.platform_payment_settings enable row level security;
alter table public.market_card_purchases enable row level security;
alter table public.market_card_invoices enable row level security;
alter table public.market_card_events enable row level security;
alter table public.market_system_audit enable row level security;
revoke all on public.platform_payment_settings,public.market_card_purchases,public.market_card_invoices,public.market_card_events,public.market_system_audit from anon,authenticated;
grant all on public.platform_payment_settings,public.market_card_purchases,public.market_card_invoices,public.market_card_events,public.market_system_audit to service_role;

-- Reserve one immutable quote while holding the same per-plugin lock as legacy bank billing.
create function public.market_card_reserve(p_salon uuid,p_plugin text) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid; c market_billing_catalog; s market_billing_settings; p market_card_purchases; cfg jsonb;
 sub text; until_time timestamptz; checkout text; amount integer; saved_customer text; actor_email text;
begin
 perform market_billing_require_owner(p_salon); actor:=current_public_user_id();
 perform pg_advisory_xact_lock(hashtextextended('market.order:'||p_salon::text||':'||p_plugin,0));
 select public_config into cfg from platform_payment_settings where id;
 if not coalesce((cfg->>'enabled')::boolean,false) or cfg->>'mode'<>'live' then raise exception 'Card payments are not connected.'; end if;
 select * into c from market_billing_catalog where plugin_id=p_plugin and published and fulfillment_ready for share;
 if c.plugin_id is null or p_plugin not in ('vietnamese-language','booking-policy','booking-deposit','checkin-receipt') then raise exception 'This plugin is not ready for card payments.'; end if;
 select * into p from market_card_purchases where salon_id=p_salon and plugin_id=p_plugin and status not in ('expired','canceled','refunded') for update;
 if found then
 if p.payer_id<>actor then raise exception 'Another owner is managing this subscription.'; end if;
 return to_jsonb(p); end if;
 if p_plugin='vietnamese-language' then select stripe_subscription,paid_until,checkout_session into sub,until_time,checkout from vietnamese_plugin_subscriptions where salon_id=p_salon for update;
 elsif p_plugin='booking-policy' then select stripe_subscription,paid_until,stripe_checkout into sub,until_time,checkout from booking_policy_subscriptions where salon_id=p_salon for update;
 elsif p_plugin='booking-deposit' then select stripe_subscription,paid_until,stripe_checkout into sub,until_time,checkout from booking_deposit_subscriptions where salon_id=p_salon for update;
 else select stripe_subscription,paid_until,stripe_checkout into sub,until_time,checkout from checkin_receipt_subscriptions where salon_id=p_salon for update; end if;
 if sub is not null or checkout is not null or until_time>now() then raise exception 'Existing billing or paid access must finish before a new subscription starts.'; end if;
 if exists(select 1 from market_bank_orders where salon_id=p_salon and plugin_id=p_plugin and (status in ('awaiting_payment','partially_paid','refund_pending') or unapplied_cents>0)) then raise exception 'An earlier bank order needs to be resolved before paying by card.'; end if;
 select * into s from market_billing_settings where id for share;
 amount:=c.price_cents+round(c.price_cents::numeric*s.tax_bps/10000)::integer;
 amount:=amount+round(amount::numeric*s.fee_bps/10000)::integer+s.fixed_fee_cents;
 select customer_id into saved_customer from market_card_purchases where salon_id=p_salon and payer_id=actor and customer_id is not null and snapshot->>'account_id'=cfg->>'accountId' order by created_at desc limit 1;
 select email into actor_email from users where id=actor;
 insert into market_card_purchases(salon_id,payer_id,plugin_id,amount_cents,snapshot)
 values(p_salon,actor,p_plugin,amount,jsonb_build_object('name',c.name,'publisher',c.publisher,'commission_bps',c.commission_bps,'price_cents',c.price_cents,'catalog_version',c.version,'settings_version',s.version,'tax_bps',s.tax_bps,'fee_bps',s.fee_bps,'fixed_fee_cents',s.fixed_fee_cents,'currency','usd','interval','month','account_id',cfg->>'accountId','customer_id',saved_customer,'customer_email',actor_email)) returning * into p;
 return to_jsonb(p);
end $$;
revoke all on function public.market_card_reserve(uuid,text) from public;
grant execute on function public.market_card_reserve(uuid,text) to authenticated;

-- Only server-verified provider state reaches this function. Payment + access commit together.
create function public.market_card_apply(p_id uuid,p_subscription text,p_customer text,p_status text,p_invoice text,p_amount integer,p_refunded integer,p_intent text,p_until timestamptz,p_observed timestamptz) returns void language plpgsql security definer set search_path=public as $$
declare p market_card_purchases; grant_until timestamptz; linked text; target text;
begin
 select * into p from market_card_purchases where id=p_id;
 if p.id is null then raise exception 'Unknown purchase'; end if;
 perform pg_advisory_xact_lock(hashtextextended('market.order:'||p.salon_id::text||':'||p.plugin_id,0));
 select * into p from market_card_purchases where id=p_id for update;
 if p.synced_at is not null and p_observed<=p.synced_at then return; end if;
 if p.subscription_id is not null and p.subscription_id<>p_subscription then raise exception 'Subscription mismatch'; end if;
 if p_amount is not null and p_amount<>p.amount_cents then raise exception 'Invoice amount mismatch'; end if;
 p_refunded:=greatest(p_refunded,coalesce((select refunded_cents from market_card_invoices where id=p_invoice),0));
 if p_refunded<0 or p_refunded>coalesce(p_amount,0) then raise exception 'Invalid refund'; end if;
 grant_until:=case when p_amount=p.amount_cents and p_refunded<p_amount then p_until else null end;
 if grant_until is not null and (not exists(select 1 from locations where id=p.salon_id and status='active') or not coalesce(lifecycle_user_is_salon_owner(p.salon_id,p.payer_id,false),false)) then raise exception 'Payment owner is no longer authorized; billing review required'; end if;
 target:=case p.plugin_id when 'vietnamese-language' then 'vietnamese_plugin_subscriptions' when 'booking-policy' then 'booking_policy_subscriptions' when 'booking-deposit' then 'booking_deposit_subscriptions' when 'checkin-receipt' then 'checkin_receipt_subscriptions' end;
 if target is null then raise exception 'Unsupported plugin'; end if;
 execute format('select stripe_subscription from public.%I where salon_id=$1 for update',target) into linked using p.salon_id;
 if linked is not null and linked<>p_subscription then
 if p.status='canceled' then return; end if;
 raise exception 'Newer subscription exists'; end if;
 if p.plugin_id='vietnamese-language' then
 insert into vietnamese_plugin_subscriptions(salon_id,installed,paid_until,payment_owner,trial_ends_at,stripe_subscription,stripe_customer)
 values(p.salon_id,true,grant_until,p.payer_id,now(),p_subscription,p_customer)
 on conflict(salon_id) do update set installed=case when p.subscription_id is null then true else vietnamese_plugin_subscriptions.installed end,paid_until=excluded.paid_until,payment_owner=excluded.payment_owner,stripe_subscription=excluded.stripe_subscription,stripe_customer=excluded.stripe_customer,checkout_reference=null,checkout_owner=null,checkout_session=null,updated_at=now();
 else
 execute format('insert into public.%I(salon_id,paid_until,payment_owner,stripe_subscription,stripe_customer) values($1,$2,$3,$4,$5) on conflict(salon_id) do update set paid_until=excluded.paid_until,payment_owner=excluded.payment_owner,stripe_subscription=excluded.stripe_subscription,stripe_customer=excluded.stripe_customer,stripe_checkout=null,updated_at=now()',target) using p.salon_id,grant_until,p.payer_id,p_subscription,p_customer;
 if p.plugin_id='booking-deposit' and p.subscription_id is null then update booking_deposit_subscriptions set installed=true where salon_id=p.salon_id; end if;
 end if;
 -- Ignore old canceled events after a newer subscription owns the entitlement.
 if p_status='canceled' then execute format('update public.%I set stripe_subscription=null where salon_id=$1 and stripe_subscription=$2',target) using p.salon_id,p_subscription; end if;
 update market_card_purchases set subscription_id=p_subscription,customer_id=p_customer,status=p_status,paid_until=grant_until,synced_at=p_observed,last_error=null,updated_at=now() where id=p.id;
 if p_invoice is not null then insert into market_card_invoices(id,purchase_id,amount_cents,refunded_cents,payment_intent,status,period_end)
 values(p_invoice,p.id,coalesce(p_amount,0),p_refunded,p_intent,case when p_amount is null then 'unpaid' when p_refunded=p_amount then 'refunded' when p_refunded>0 then 'partially_refunded' else 'paid' end,p_until)
 on conflict(id) do update set amount_cents=excluded.amount_cents,refunded_cents=excluded.refunded_cents,payment_intent=excluded.payment_intent,status=excluded.status,period_end=excluded.period_end,updated_at=now(); end if;
end $$;
revoke all on function public.market_card_apply(uuid,text,text,text,text,integer,integer,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.market_card_apply(uuid,text,text,text,text,integer,integer,text,timestamptz,timestamptz) to service_role;
-- Bank records remain available for settlement, but new purchases use the card reservation above.
revoke execute on function public.market_billing_create_order(uuid,text,uuid) from authenticated;
commit;

