-- Operational durability for the existing test-only full-refund action.
-- No live switch, commission, entitlement or refund-liability policy is added.
create table market_platform.refund_intents (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null unique references market_platform.orders(id),
 charge_id text not null check(charge_id ~ '^ch_[A-Za-z0-9]+$'),
 amount_cents integer not null check(amount_cents>0),
 status text not null default 'requested' check(status in ('requested','pending','requires_action','succeeded','failed','canceled')),
 refund_id text unique check(refund_id ~ '^re_[A-Za-z0-9]+$'),
 created_at timestamptz not null default now(), observed_at timestamptz,
 check((status='requested' and refund_id is null and observed_at is null)
    or (status<>'requested' and refund_id is not null and observed_at is not null))
);
alter table market_platform.refund_intents enable row level security;
revoke all on market_platform.refund_intents from public,anon,authenticated,service_role;
create function market_platform.guard_refund_intent() returns trigger language plpgsql set search_path=pg_catalog,market_platform as $$
begin
 if (new.id,new.order_id,new.charge_id,new.amount_cents,new.created_at) is distinct from
    (old.id,old.order_id,old.charge_id,old.amount_cents,old.created_at) then
   raise exception using errcode='PT409',message='Immutable refund request.';
 end if;
 return new;
end $$;
create trigger immutable_refund_intent before update on market_platform.refund_intents
 for each row execute function market_platform.guard_refund_intent();
revoke all on function market_platform.guard_refund_intent() from public,anon,authenticated,service_role;

create or replace function public.market_platform_refund_quote(p_order uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor(); o orders; intent refund_intents; requested timestamptz;
begin
 perform public.market_billing_require_admin();
 if not exists(select 1 from settings where id and enabled and commerce_test_enabled) then raise exception using errcode='42501',message='Test commerce disabled.'; end if;
 select * into o from orders where id=p_order for update;
 if o.id is null or o.charge_id is null or o.state<>'paid' or o.refunded_cents>0 or o.disputed then raise exception using errcode='PT409',message='Only a paid undisputed order can request a full test refund.'; end if;
 -- Preserve the earliest legacy attempt time; never restart an expired provider
 -- idempotency window just because the durable table was introduced later.
 select min(created_at) into requested from events where object_id=o.id and kind='full_test_refund_requested';
 insert into refund_intents(order_id,charge_id,amount_cents,created_at)
 values(o.id,o.charge_id,o.amount_cents,coalesce(requested,now())) on conflict(order_id) do nothing;
 if found then insert into events(actor_id,kind,object_id) values(actor,'full_test_refund_requested',o.id); end if;
 select * into intent from refund_intents where order_id=o.id;
 if intent.charge_id<>o.charge_id or intent.amount_cents<>o.amount_cents then raise exception using errcode='PT409',message='Refund request needs reconciliation.'; end if;
 return to_jsonb(o)||jsonb_build_object('refund_intent',to_jsonb(intent));
end $$;

create function public.market_platform_refund_observation_apply(p_intent uuid,p_refund text,p_status text) returns boolean language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare intent refund_intents;
begin
 if not exists(select 1 from settings where id and enabled and commerce_test_enabled) then raise exception using errcode='42501',message='Test commerce disabled.'; end if;
 if p_refund is null or p_refund !~ '^re_[A-Za-z0-9]+$' or p_status is null or p_status not in ('pending','requires_action','succeeded','failed','canceled') then raise exception using errcode='22023',message='Invalid refund observation.'; end if;
 select * into intent from refund_intents where id=p_intent for update;
 if intent.id is null or (intent.refund_id is not null and intent.refund_id<>p_refund)
 or (intent.status in ('succeeded','failed','canceled') and intent.status<>p_status) then raise exception using errcode='PT409',message='Refund observation needs reconciliation.'; end if;
 update refund_intents set refund_id=p_refund,status=p_status,observed_at=now() where id=intent.id;
 -- A request/observation never changes an order or its entitlement.
 return true;
end $$;
revoke all on function public.market_platform_refund_observation_apply(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.market_platform_refund_observation_apply(uuid,text,text) to service_role;

-- Verified charge-event reconciliation may finish the request observation even
-- after payment_apply has revoked the order. No intent is invented for an
-- external refund; the charge/amount must match the pre-existing request.
create function public.market_platform_refund_observation_for_order_apply(p_order uuid,p_charge text,p_amount integer,p_refund text,p_status text) returns boolean language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare intent refund_intents;
begin
 if not exists(select 1 from settings where id and enabled and commerce_test_enabled) then raise exception using errcode='42501',message='Test commerce disabled.'; end if;
 select * into intent from refund_intents where order_id=p_order for update;
 if intent.id is null then return true; end if;
 if intent.charge_id is distinct from p_charge or intent.amount_cents is distinct from p_amount
 or not exists(select 1 from orders where id=p_order and charge_id=p_charge and amount_cents=p_amount) then raise exception using errcode='PT409',message='Refund observation needs reconciliation.'; end if;
 return public.market_platform_refund_observation_apply(intent.id,p_refund,p_status);
end $$;
revoke all on function public.market_platform_refund_observation_for_order_apply(uuid,text,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.market_platform_refund_observation_for_order_apply(uuid,text,integer,text,text) to service_role;

create or replace function public.market_platform_finance_workspace() returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor();
begin
 perform public.market_billing_require_admin();
 return jsonb_build_object('testEnabled',(select enabled and commerce_test_enabled from settings where id),
 'orders',coalesce((select jsonb_agg(to_jsonb(o)) from orders o),'[]'::jsonb),
 'refundIntents',coalesce((select jsonb_agg(to_jsonb(r)) from refund_intents r),'[]'::jsonb),
 'payouts',coalesce((select jsonb_agg(to_jsonb(p)) from payouts p),'[]'::jsonb));
end $$;
revoke all on function public.market_platform_refund_quote(uuid), public.market_platform_finance_workspace() from public,anon,authenticated,service_role;
grant execute on function public.market_platform_refund_quote(uuid), public.market_platform_finance_workspace() to authenticated;
