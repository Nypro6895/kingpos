begin;

-- An automatic order is an intent until the wallet-locked processing claim.
-- Preserve the original request and its budget period across retries, month
-- boundaries and later card/pack changes. These columns do not change amounts.
alter table public.campaign_credit_orders add column automatic_budget_month date;
alter table public.campaign_credit_orders add column claim_payload jsonb;
alter table public.campaign_credit_orders add constraint campaign_credit_budget_month
 check (automatic_budget_month is null or (automatic and extract(day from automatic_budget_month)=1));
alter table public.campaign_credit_orders add constraint campaign_credit_claim_payload
 check (claim_payload is null or (automatic and jsonb_typeof(claim_payload)='object'));

-- Historical processing start times cannot be reconstructed. Reserve unresolved
-- legacy processing against this month conservatively, without inventing a
-- provider request. Paid legacy attribution uses the recorded purchase ledger
-- timestamp when present, then the former order timestamp as a fallback.
update public.campaign_credit_orders o set automatic_budget_month=
 case when o.status='processing' then date_trunc('month',now() at time zone 'America/Chicago')::date
 else date_trunc('month',coalesce((select min(l.created_at) from public.campaign_credit_ledger l
   where l.salon_id=o.salon_id and l.kind='purchase' and l.reference='purchase:'||o.provider_reference),o.created_at)
   at time zone 'America/Chicago')::date end
 where o.automatic and o.status in ('processing','paid');
create index campaign_credit_budget_period on public.campaign_credit_orders(salon_id,automatic_budget_month)
 where automatic and status in ('processing','paid');

-- A low wallet is not itself a request to buy. Campaign reserves belong to
-- their campaigns; only a currently eligible, unpaused funding shortfall is
-- demand. An expiring running period can reuse its own unused released reserve
-- when renewing, so it must not trigger a needless purchase beforehand.
create function public.campaign_credit_has_active_demand(p_salon uuid,p_owner uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select public.campaign_plugin_installed(p_salon)
  and coalesce((select (config->>'enabled')::boolean from public.owner_campaign_settings where id),false)
  and exists(select 1 from public.campaign_wallets w where w.salon_id=p_salon and (
   exists(select 1 from public.owner_campaigns a where a.salon_id=p_salon and a.owner_id=p_owner
    and a.owner_paused_at is null and a.archived_at is null and a.auto_fund and a.status='awaiting_payment'
    and a.total_price_cents>w.available_credits
    and public.owner_campaign_post(a.source_type,a.source_id,p_salon) is not null)
   or exists(select 1 from public.owner_campaigns c where c.salon_id=p_salon
    and c.owner_paused_at is null and c.archived_at is null and c.keep_running
    and c.status in ('running','completed') and c.ends_at<=now()
    and coalesce(c.cycle_credit_limit,c.daily_price_cents*c.days)>
     w.available_credits+case when c.status='running' then greatest(0,c.reserved_credits-c.spent_cents-c.released_credits) else 0 end
    and public.owner_campaign_post(c.source_type,c.source_id,p_salon) is not null
    and not exists(select 1 from public.owner_campaigns other where other.id<>c.id and other.salon_id=p_salon
     and other.source_type=c.source_type and other.source_id=c.source_id
     and other.status in ('awaiting_payment','pending_review','running','paused')))
  ));
$$;

create function public.campaign_credit_automatic_total(p_salon uuid,p_month date) returns bigint
language sql stable security definer set search_path=public as $$
 select coalesce(sum(o.amount_cents),0) from public.campaign_credit_orders o
 where o.salon_id=p_salon and o.automatic and o.status in ('processing','paid')
  and o.automatic_budget_month=p_month;
$$;

create or replace function public.campaign_credit_preferences(p_salon uuid,p_owner uuid,p_enabled boolean,p_amount integer,p_threshold integer,p_limit integer) returns void
language plpgsql security definer set search_path=public as $$
declare w public.campaign_wallets;o public.campaign_credit_orders;
begin
 select * into w from public.campaign_wallets where salon_id=p_salon for update;
 if p_enabled and w.payment_blocked then raise exception 'Allow payments before turning on automatic purchases.'; end if;
 -- Keep the existing authorization, validation and explicit consent behavior.
 perform public.campaign_credit_preferences_before_workspace(p_salon,p_owner,p_enabled,p_amount,p_threshold,p_limit);
 if not p_enabled then
  update public.owner_campaigns set auto_fund=false where salon_id=p_salon;
  update public.campaign_credit_orders set status='cancelled' where salon_id=p_salon and automatic and status='pending';
 elsif w.topup_credits is distinct from p_amount then
  select * into o from public.campaign_credit_orders where salon_id=p_salon and status in ('pending','processing') for update;
  if o.owner_id=p_owner and o.automatic and o.status='pending' and o.claim_payload is null
   and o.automatic_budget_month is null and o.provider_reference is null and o.checkout_session_id is null then
   update public.campaign_credit_orders set status='cancelled',error='Superseded by owner automatic credit pack change before claim.' where id=o.id;
  end if;
 end if;
end $$;

create or replace function public.campaign_credit_order(p_salon uuid,p_owner uuid,p_amount integer,p_auto boolean default false) returns uuid
language plpgsql security definer set search_path=public as $$
declare w public.campaign_wallets;o public.campaign_credit_orders;oid uuid;demand boolean;budget_month date;
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,p_owner,false),false)
    or not public.campaign_plugin_installed(p_salon) then raise exception 'Owner access required.'; end if;
 select * into w from public.campaign_wallets where salon_id=p_salon for update;
 if w.payment_blocked then raise exception 'Payments are blocked. Update payment methods first.'; end if;
 if p_amount not in (500,1500,5000) then raise exception 'Choose an available credit pack.'; end if;
 demand:=public.campaign_credit_has_active_demand(p_salon,p_owner);
 select * into o from public.campaign_credit_orders where salon_id=p_salon and status in ('pending','processing') for update;
 if o.id is not null then
  -- An explicit manual purchase may replace only an unclaimed, obsolete
  -- automatic intent. Never cancel another owner's intent, checkout, unknown
  -- provider outcome or an order still serving another campaign's demand.
  if not p_auto and o.automatic and o.owner_id=p_owner and o.status='pending' and not demand
    and o.automatic_budget_month is null and o.claim_payload is null
    and o.provider_reference is null and o.checkout_session_id is null then
   update public.campaign_credit_orders set status='cancelled',error='Superseded by owner manual credit purchase before automatic claim.' where id=o.id;
  else
   if p_auto and o.automatic and o.status='pending' and not demand then return null; end if;
   return o.id;
  end if;
 end if;
 if p_auto then
  if not w.auto_topup_enabled or w.payment_owner is distinct from p_owner or w.stripe_payment_method is null
    or w.stripe_customer is null or w.topup_credits<>p_amount or not demand then return null; end if;
  budget_month:=date_trunc('month',clock_timestamp() at time zone 'America/Chicago')::date;
  if public.campaign_credit_automatic_total(p_salon,budget_month)+p_amount>w.monthly_limit_cents then
   perform public.campaign_credit_notice(p_salon,'monthly:'||to_char(budget_month,'YYYY-MM'),'Automatic credit limit reached',
    'No more automatic credits will be purchased within this monthly limit. Review your limit in Settings.','/campaigns?tab=settings');
   return null;
  end if;
 end if;
 insert into public.campaign_credit_orders(salon_id,owner_id,credits,amount_cents,automatic,payment_revision)
  values(p_salon,p_owner,p_amount,p_amount,p_auto,w.payment_revision) returning id into oid;
 return oid;
end $$;

create or replace function public.campaign_credit_claim(p_order uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare w public.campaign_wallets;o public.campaign_credit_orders;payload jsonb;started timestamptz;budget_month date;
begin
 select * into w from public.campaign_wallets where salon_id=(select salon_id from public.campaign_credit_orders where id=p_order) for update;
 select * into o from public.campaign_credit_orders where id=p_order for update;
 if o.id is null or not o.automatic or o.status not in ('pending','processing') then return null; end if;
 -- Explicit wallet Stop/block still prevents new worker requests. A verified
 -- late provider success continues to settle through campaign_credit_paid.
 if w.payment_blocked or not w.auto_topup_enabled or w.payment_owner is distinct from o.owner_id then return null; end if;
 if o.status='processing' then
  if o.claim_payload is null or not (o.claim_payload ?& array['customer','method','amount','claimed_at']) then
   raise exception 'Automatic payment outcome requires reconciliation before retry.';
  end if;
  payload:=o.claim_payload;started:=(payload->>'claimed_at')::timestamptz;
  if o.provider_reference is not null then return payload||jsonb_build_object('provider_reference',o.provider_reference); end if;
  -- Stripe may prune a v1 idempotency key after 24h. Stop unknown retries five
  -- minutes earlier for request latency/clock uncertainty; a late outcome
  -- must be reconciled, never retried as a potentially new charge.
  if started is null or started<=clock_timestamp()-interval '23 hours 55 minutes' then
   raise exception 'Automatic payment outcome requires reconciliation before retry.';
  end if;
  return payload;
 end if;
 if not public.campaign_plugin_installed(w.salon_id)
  or not coalesce((select (config->>'enabled')::boolean from public.owner_campaign_settings where id),false)
  or w.stripe_customer is null or w.stripe_payment_method is null or w.topup_credits<>o.credits
  or not public.campaign_credit_has_active_demand(w.salon_id,o.owner_id) then return null; end if;
 started:=clock_timestamp();
 budget_month:=date_trunc('month',started at time zone 'America/Chicago')::date;
 if public.campaign_credit_automatic_total(w.salon_id,budget_month)+o.amount_cents>w.monthly_limit_cents then return null; end if;
 if o.claim_payload is not null or o.automatic_budget_month is not null or o.provider_reference is not null or o.checkout_session_id is not null then
  raise exception 'Automatic payment outcome requires reconciliation before retry.';
 end if;
 payload:=jsonb_build_object('customer',w.stripe_customer,'method',w.stripe_payment_method,'amount',o.amount_cents,'claimed_at',started);
 update public.campaign_credit_orders set status='processing',automatic_budget_month=budget_month,claim_payload=payload where id=p_order;
 return payload;
end $$;

create or replace function public.campaign_credit_paid(p_order uuid,p_reference text,p_amount integer,p_customer text default null,p_method text default null) returns void
language plpgsql security definer set search_path=public as $$
declare w public.campaign_wallets;o public.campaign_credit_orders;
begin
 select * into w from public.campaign_wallets where salon_id=(select salon_id from public.campaign_credit_orders where id=p_order) for update;
 select * into o from public.campaign_credit_orders where id=p_order for update;
 if w.payment_blocked or coalesce(o.payment_revision,0)<>w.payment_revision then p_method:=null; end if;
 -- This existing function validates amount/reference, grants once and keeps
 -- the same purchase ledger key. A cap never discards already paid credit.
 perform public.campaign_credit_paid_before_workspace(p_order,p_reference,p_amount,p_customer,p_method);
 update public.campaign_credit_orders set error=null where id=p_order and status='paid';
 if o.automatic and o.automatic_budget_month is null then
  update public.campaign_credit_orders set automatic_budget_month=date_trunc('month',coalesce(
   (select min(l.created_at) from public.campaign_credit_ledger l where l.salon_id=o.salon_id
    and l.kind='purchase' and l.reference='purchase:'||p_reference),o.created_at) at time zone 'America/Chicago')::date where id=p_order;
 end if;
end $$;

-- Service entrypoint only, after reading a matching provider intent whose
-- status is canceled. Unlike an unknown/processing/action-required response,
-- this is terminal evidence of no charge. Release the queue slot and budget
-- reservation atomically; never change the owner's automatic preference.
create function public.campaign_credit_cancelled(p_order uuid,p_reference text) returns boolean
language plpgsql security definer set search_path=public as $$
declare w public.campaign_wallets;o public.campaign_credit_orders;
begin
 select * into w from public.campaign_wallets where salon_id=(select salon_id from public.campaign_credit_orders where id=p_order) for update;
 select * into o from public.campaign_credit_orders where id=p_order for update;
 if o.id is null or not o.automatic or p_reference is null or p_reference!~'^pi_[a-zA-Z0-9]+$'
   or (o.provider_reference is not null and o.provider_reference<>p_reference) then raise exception 'Verified automatic payment reference required.'; end if;
 if o.status='paid' then return false; end if;
 if o.status='failed' and o.provider_reference=p_reference then return true; end if;
 if o.status<>'processing' then raise exception 'Automatic payment is not processing.'; end if;
 -- An operator may supply a verified reference for legacy unknown processing.
 -- Bind it only here under the same locks, never overwrite an existing intent.
 update public.campaign_credit_orders set status='failed',provider_reference=p_reference,error='Payment provider confirmed this automatic payment was canceled. No credits were purchased.' where id=p_order;
 return true;
end $$;

-- Intent supersession is an audit event, not a failed card payment. Keep the
-- existing notices for real failed/processing outcomes and successful credits.
do $$
declare definition text;target text:='elsif new.automatic and (new.status=''failed'' or new.error is not null)';
begin
 definition:=pg_get_functiondef('public.campaign_credit_notices()'::regprocedure);
 if (length(definition)-length(replace(definition,target,'')))/length(target)<>1 then
  raise exception 'Campaign credit notice guard definition changed; review required.';
 end if;
 execute replace(definition,target,'elsif new.automatic and new.status<>''cancelled'' and (new.status=''failed'' or new.error is not null)');
end $$;

revoke all on function public.campaign_credit_has_active_demand(uuid,uuid),public.campaign_credit_automatic_total(uuid,date) from public,anon,authenticated,service_role;
revoke all on function public.campaign_credit_order(uuid,uuid,integer,boolean),public.campaign_credit_claim(uuid),public.campaign_credit_paid(uuid,text,integer,text,text),public.campaign_credit_cancelled(uuid,text) from public,anon,authenticated;
grant execute on function public.campaign_credit_order(uuid,uuid,integer,boolean),public.campaign_credit_claim(uuid),public.campaign_credit_paid(uuid,text,integer,text,text),public.campaign_credit_cancelled(uuid,text) to service_role;

notify pgrst,'reload schema';
commit;
