begin;
-- Test-only commerce. No live switch exists in this implementation.
alter table market_platform.settings add column commerce_test_enabled boolean not null default false;
alter table market_platform.settings add column commission_bps integer check(commission_bps between 0 and 10000);
create table market_platform.sellers(
 organization_id uuid primary key references market_platform.organizations(id),account_id text unique,
 charges_enabled boolean not null default false,payouts_enabled boolean not null default false,
 details_submitted boolean not null default false,updated_at timestamptz not null default now()
);
create table market_platform.orders(
 id uuid primary key default gen_random_uuid(),salon_id uuid not null references public.locations(id),
 version_id uuid not null references market_platform.versions(id),buyer_id uuid references public.users(id) on delete set null,
 account_id text not null,amount_cents integer not null check(amount_cents>0),fee_cents integer not null check(fee_cents>=0 and fee_cents<=amount_cents),
 state text not null default 'pending' check(state in ('pending','paid','revoked','expired')),
 checkout_id text unique,charge_id text unique,refunded_cents integer not null default 0,
 disputed boolean not null default false,transfer_id text,observed_at timestamptz,created_at timestamptz not null default now(),
 unique(salon_id,version_id)
);
create table market_platform.payment_events(
 id text primary key,kind text not null,order_id uuid references market_platform.orders(id),
 created_at timestamptz not null default now()
);
create table market_platform.payouts(
 account_id text not null,payout_id text not null,amount_cents integer not null,currency text not null,
 status text not null,observed_at timestamptz not null,primary key(account_id,payout_id)
);

create or replace function market_platform.entitled(p_salon uuid,p_version uuid) returns boolean language sql stable security definer set search_path=pg_catalog,market_platform as $$
 select exists(select 1 from versions where id=p_version and (manifest->'price'->>'amountCents')::integer=0)
 or exists(select 1 from orders o where o.salon_id=p_salon and o.version_id=p_version and o.state='paid' and o.refunded_cents=0 and not o.disputed
 and coalesce(public.lifecycle_user_is_salon_owner(o.salon_id,o.buyer_id,false),false))
$$;

create function public.market_platform_seller() returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor(); oid uuid;
begin
 select id into oid from organizations where owner_id=actor;
 if oid is null then raise exception using errcode='42501',message='Developer organization required.'; end if;
 insert into sellers(organization_id) values(oid) on conflict do nothing;
 return (select to_jsonb(s)||jsonb_build_object('testEnabled',(select commerce_test_enabled and commission_bps is not null from settings where id)) from sellers s where organization_id=oid);
end $$;

create function public.market_platform_quote(p_salon uuid,p_version uuid,p_sha256 text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor(); v versions; seller sellers; o orders; bps integer; amount integer;
begin
 select commission_bps into bps from settings where id and commerce_test_enabled for share;
 if bps is null then raise exception using errcode='42501',message='Marketplace test payments await approved configuration.'; end if;
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,actor,false),false) or not exists(select 1 from public.locations where id=p_salon and status='active') then raise exception using errcode='42501',message='Active salon owner required.'; end if;
 select * into v from versions where id=p_version and sha256=p_sha256;
 if v.id is null or not exists(select 1 from reviews where version_id=v.id and decision='approved') then raise exception using errcode='PT409',message='Choose an exact approved version.'; end if;
 select s.* into seller from sellers s join apps a on a.organization_id=s.organization_id and a.active join organizations org on org.id=s.organization_id join public.users u on u.id=org.owner_id and u.status='active' where a.id=v.app_id and s.charges_enabled and s.payouts_enabled;
 if seller.account_id is null then raise exception using errcode='42501',message='Seller onboarding is incomplete.'; end if;
 amount:=(v.manifest->'price'->>'amountCents')::integer;
 if amount<50 then raise exception using errcode='22023',message='Paid USD versions must cost at least 50 cents.'; end if;
 insert into orders(salon_id,version_id,buyer_id,account_id,amount_cents,fee_cents)
 values(p_salon,v.id,actor,seller.account_id,amount,floor(amount::numeric*bps/10000)::integer) on conflict(salon_id,version_id) do nothing;
 select * into o from orders where salon_id=p_salon and version_id=v.id for update;
 if o.buyer_id is distinct from actor or o.account_id<>seller.account_id or o.state in ('revoked','expired') then raise exception using errcode='PT409',message='This purchase needs marketplace support reconciliation before retry.'; end if;
 return to_jsonb(o)||jsonb_build_object('name',v.manifest->>'name');
end $$;

-- Service callbacks are isolated to these new tables and RPCs. The server must
-- verify signature, test mode, provider account and current provider object.
create function public.market_platform_seller_apply(p_organization uuid,p_account text,p_charges boolean,p_payouts boolean,p_details boolean) returns boolean language plpgsql security definer set search_path=pg_catalog,market_platform as $$
begin
 if not exists(select 1 from settings where id and enabled and commerce_test_enabled and commission_bps is not null) then raise exception using errcode='42501',message='Test commerce disabled.'; end if;
 if p_account is null or p_account !~ '^acct_[A-Za-z0-9]+$' then raise exception using errcode='22023',message='Invalid provider account.'; end if;
 insert into sellers(organization_id,account_id,charges_enabled,payouts_enabled,details_submitted) values(p_organization,p_account,p_charges,p_payouts,p_details)
 on conflict(organization_id) do update set account_id=excluded.account_id,charges_enabled=excluded.charges_enabled,payouts_enabled=excluded.payouts_enabled,details_submitted=excluded.details_submitted,updated_at=now()
 where sellers.account_id is null or sellers.account_id=excluded.account_id;
 if not found then raise exception using errcode='PT409',message='Seller account cannot be replaced.'; end if;
 return true;
end $$;

create function public.market_platform_checkout_apply(p_order uuid,p_checkout text) returns boolean language plpgsql security definer set search_path=pg_catalog,market_platform as $$
begin
 if p_checkout !~ '^cs_test_[A-Za-z0-9]+$' then raise exception using errcode='22023',message='Test checkout required.'; end if;
 update orders set checkout_id=p_checkout where id=p_order and (checkout_id is null or checkout_id=p_checkout);
 if not found then raise exception using errcode='PT409',message='Checkout mismatch.'; end if;
 return true;
end $$;

create function public.market_platform_payment_apply(p_event text,p_kind text,p_order uuid,p_checkout text,p_charge text,p_amount integer,p_fee integer,p_account text,p_refunded integer,p_disputed boolean,p_transfer text,p_observed timestamptz) returns boolean language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare o orders;
begin
 if not exists(select 1 from settings where id and enabled and commerce_test_enabled) then raise exception using errcode='42501',message='Test commerce disabled.'; end if;
 select * into o from orders where id=p_order for update;
 if o.id is null or o.checkout_id is distinct from p_checkout or o.amount_cents is distinct from p_amount or o.fee_cents is distinct from p_fee or o.account_id is distinct from p_account
 or p_charge is null or p_charge !~ '^ch_[A-Za-z0-9]+$' or p_refunded is null or p_refunded<0 or p_refunded>o.amount_cents or p_disputed is null or p_observed is null or p_event is null or p_event !~ '^evt_[A-Za-z0-9]+$' then
 raise exception using errcode='22023',message='Payment does not match immutable purchase.'; end if;
 if exists(select 1 from payment_events where id=p_event) then
  if not exists(select 1 from payment_events where id=p_event and order_id=o.id and kind=p_kind) then raise exception using errcode='PT409',message='Event already belongs to another operation.'; end if;
  return true;
 end if;
 if o.charge_id is not null and o.charge_id<>p_charge then raise exception using errcode='PT409',message='Charge mismatch.'; end if;
 if o.observed_at is null or p_observed>=o.observed_at then
  update orders set charge_id=p_charge,refunded_cents=greatest(refunded_cents,p_refunded),disputed=p_disputed,
  state=case when greatest(o.refunded_cents,p_refunded)>0 or p_disputed then 'revoked' else 'paid' end,transfer_id=p_transfer,observed_at=p_observed where id=o.id;
 end if;
 insert into payment_events(id,kind,order_id) values(p_event,left(p_kind,100),o.id);
 return true;
end $$;

create function public.market_platform_commerce_workspace() returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor(); oid uuid;
begin
 select id into oid from organizations where owner_id=actor;
 return jsonb_build_object('seller',(select to_jsonb(s) from sellers s where organization_id=oid),
 'testEnabled',(select commerce_test_enabled and commission_bps is not null from settings where id),
 'orders',coalesce((select jsonb_agg(to_jsonb(o)) from orders o join versions v on v.id=o.version_id join apps a on a.id=v.app_id where a.organization_id=oid or o.buyer_id=actor),'[]'::jsonb),
 'payouts',coalesce((select jsonb_agg(to_jsonb(p)) from payouts p join sellers s on s.account_id=p.account_id where s.organization_id=oid),'[]'::jsonb));
end $$;

-- Financial authority stays separate from the metadata reviewer allowlist.
create function public.market_platform_refund_quote(p_order uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor(); o orders;
begin
 perform public.market_billing_require_admin();
 if not exists(select 1 from settings where id and commerce_test_enabled) then raise exception using errcode='42501',message='Test commerce disabled.'; end if;
 select * into o from orders where id=p_order for update;
 if o.id is null or o.charge_id is null or o.state<>'paid' or o.refunded_cents>0 or o.disputed then raise exception using errcode='PT409',message='Only a paid undisputed order can request a full test refund.'; end if;
 insert into events(actor_id,kind,object_id) values(actor,'full_test_refund_requested',o.id);
 return to_jsonb(o);
end $$;

create function public.market_platform_finance_workspace() returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor();
begin
 perform public.market_billing_require_admin();
 return jsonb_build_object('orders',coalesce((select jsonb_agg(to_jsonb(o)) from orders o),'[]'::jsonb),
 'payouts',coalesce((select jsonb_agg(to_jsonb(p)) from payouts p),'[]'::jsonb));
end $$;

create function public.market_platform_payout_apply(p_account text,p_id text,p_amount integer,p_currency text,p_status text,p_observed timestamptz) returns boolean language plpgsql security definer set search_path=pg_catalog,market_platform as $$
begin
 if not exists(select 1 from settings where id and commerce_test_enabled) or not exists(select 1 from sellers where account_id=p_account) then raise exception using errcode='42501',message='Known test seller required.'; end if;
 if p_id is null or p_id !~ '^po_[A-Za-z0-9]+$' or p_amount is null or p_amount<0 or p_currency is distinct from 'usd' or p_status is null or p_status not in ('pending','in_transit','paid','failed','canceled') or p_observed is null then raise exception using errcode='22023',message='Invalid payout observation.'; end if;
 insert into payouts values(p_account,p_id,p_amount,p_currency,p_status,p_observed) on conflict(account_id,payout_id) do update set amount_cents=excluded.amount_cents,status=excluded.status,observed_at=excluded.observed_at where payouts.observed_at<=excluded.observed_at;
 return true;
end $$;

do $$declare t text; f record; begin
 foreach t in array array['sellers','orders','payment_events','payouts'] loop
 execute format('alter table market_platform.%I enable row level security',t);execute format('revoke all on market_platform.%I from public,anon,authenticated,service_role',t);end loop;
 for f in select p.oid::regprocedure signature,p.proname name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('market_platform_seller','market_platform_quote','market_platform_commerce_workspace','market_platform_seller_apply','market_platform_checkout_apply','market_platform_payment_apply','market_platform_payout_apply','market_platform_refund_quote','market_platform_finance_workspace') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 execute format('grant execute on function %s to %I',f.signature,case when f.name like '%_apply' then 'service_role' else 'authenticated' end);
 end loop;
end $$;
commit;
