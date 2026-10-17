begin;
alter table public.campaign_wallets add column payment_blocked boolean not null default false;
alter table public.campaign_wallets add column low_credit_reminders boolean not null default true;
alter table public.campaign_wallets add column payment_revision integer not null default 0;
alter table public.campaign_credit_orders add column payment_revision integer;
alter table public.campaign_credit_orders add column checkout_session_id text;
alter table public.owner_campaigns add column cycle_credit_limit integer check(cycle_credit_limit > 0);
alter table public.owner_campaigns add column auto_fund boolean not null default false;
create table public.campaign_card_setups (
 id uuid primary key, salon_id uuid not null references public.locations(id), owner_id uuid not null references public.users(id),
 status text not null default 'pending' check(status in ('pending','completed','cancelled')), payment_revision integer not null default 0, created_at timestamptz not null default now()
);
alter table public.campaign_card_setups enable row level security;
revoke all on public.campaign_card_setups from public,anon,authenticated;
grant all on public.campaign_card_setups to service_role;

create function public.owner_campaign_daily_results(p_salon uuid,p_owner uuid,p_campaign uuid,p_days integer default 7)
returns table(day date,views bigint,likes bigint,comments bigint,bookings bigint)
language plpgsql security definer set search_path=public as $$
begin
 if not coalesce(lifecycle_user_is_salon_owner(p_salon,p_owner,false),false) then raise exception 'Owner access required.'; end if;
 if not exists(select 1 from owner_campaigns where id=p_campaign and salon_id=p_salon) then raise exception 'Campaign not found.'; end if;
 return query with activity as (
  select e.day,e.kind from owner_campaign_events e where e.campaign_id=p_campaign
  union all
  select (c.created_at at time zone 'America/Chicago')::date,c.kind from owner_campaign_conversions c where c.campaign_id=p_campaign
 ) select a.day,count(*) filter(where a.kind='view'),count(*) filter(where a.kind='like'),count(*) filter(where a.kind='comment'),count(*) filter(where a.kind='book')
 from activity a where a.day >= (now() at time zone 'America/Chicago')::date-least(89,greatest(0,p_days-1)) group by a.day order by a.day;
end $$;

create function public.campaign_set_credit_limit(p_salon uuid,p_owner uuid,p_campaign uuid,p_limit integer,p_keep boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare c owner_campaigns; w campaign_wallets; previous_limit integer; delta integer; period_spent integer; base integer;
begin
 if not coalesce(lifecycle_user_is_salon_owner(p_salon,p_owner,false),false) or not campaign_plugin_installed(p_salon) then raise exception 'Owner access required.'; end if;
 select * into w from campaign_wallets where salon_id=p_salon for update;
 select * into c from owner_campaigns where id=p_campaign and salon_id=p_salon for update;
 if c.id is null or c.status not in ('awaiting_payment','pending_review','running','paused') then raise exception 'This ad cannot be edited. Run it again to choose a new limit.'; end if;
 previous_limit:=coalesce(c.cycle_credit_limit,c.daily_price_cents*c.days);
 base:=greatest(0,c.total_price_cents-previous_limit);
 period_spent:=greatest(0,c.spent_cents-base);
 if p_limit is null or p_limit<greatest(1,period_spent) or p_limit>c.daily_price_cents*c.days then raise exception 'Choose a limit between credits already used and the estimated maximum.'; end if;
 delta:=p_limit-previous_limit;
 if c.status<>'awaiting_payment' and delta<>0 then
  if delta>w.available_credits then raise exception 'Add credits before raising this limit.'; end if;
  update campaign_wallets set available_credits=available_credits-delta,reserved_credits=reserved_credits+delta,updated_at=now() where salon_id=p_salon;
  insert into campaign_credit_ledger(salon_id,reference,kind,credits) values(p_salon,'limit:'||gen_random_uuid(),case when delta>0 then 'reserve' else 'release' end,-delta);
 end if;
 update owner_campaigns set cycle_credit_limit=p_limit,total_price_cents=base+p_limit,
 reserved_credits=reserved_credits+case when status<>'awaiting_payment' then delta else 0 end,
 keep_running=p_keep,updated_at=now() where id=p_campaign;
end $$;

-- Create and set the ceiling in one transaction, before credits are reserved.
create function public.campaign_create_with_limit(p_id uuid,p_salon uuid,p_user uuid,p_type text,p_source uuid,p_area text,p_location text,p_country text,p_state text,p_city text,p_views integer,p_days integer,p_limit integer,p_keep boolean,p_auto boolean)
returns uuid language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
 if not coalesce(lifecycle_user_is_salon_owner(p_salon,p_user,false),false) then raise exception 'Owner access required.'; end if;
 perform 1 from campaign_wallets where salon_id=p_salon for update;
 -- Retries must not change an already funded ad or create another reservation.
 if exists(select 1 from owner_campaigns where id=p_id) then
  if not exists(select 1 from owner_campaigns where id=p_id and salon_id=p_salon and owner_id=p_user and source_type=p_type and source_id=p_source) then raise exception 'Reopen the ad and try again.'; end if;
  return p_id;
 end if;
 cid:=owner_campaign_create(p_id,p_salon,p_user,p_type,p_source,p_area,p_location,p_country,p_state,p_city,p_views,p_days);
 perform campaign_set_credit_limit(p_salon,p_user,cid,p_limit,p_keep);
 update owner_campaigns set auto_fund=p_auto and (select auto_topup_enabled and not payment_blocked from campaign_wallets where salon_id=p_salon) where id=cid;
 return cid;
end $$;

create function public.campaign_payment_controls(p_salon uuid,p_owner uuid,p_action text)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not coalesce(lifecycle_user_is_salon_owner(p_salon,p_owner,false),false) then raise exception 'Owner access required.'; end if;
 perform 1 from campaign_wallets where salon_id=p_salon for update;
 if p_action not in ('block','unblock','stop') then raise exception 'Invalid payment choice.'; end if;
 update campaign_wallets set payment_blocked=case when p_action='block' then true when p_action='unblock' then false else payment_blocked end,
 auto_topup_enabled=false,auto_topup_consent_at=null,payment_revision=payment_revision+1,updated_at=now() where salon_id=p_salon;
 update owner_campaigns set auto_fund=false where salon_id=p_salon;
 update campaign_credit_orders set status='cancelled' where salon_id=p_salon and automatic and status='pending';
 if p_action='block' then update campaign_card_setups set status='cancelled' where salon_id=p_salon and status='pending'; end if;
end $$;

create function public.campaign_save_card(p_setup uuid,p_owner uuid,p_customer text,p_method text)
returns void language plpgsql security definer set search_path=public as $$
declare s campaign_card_setups;
begin
 select * into s from campaign_card_setups where id=p_setup;
 if s.id is null or s.owner_id<>p_owner or not coalesce(lifecycle_user_is_salon_owner(s.salon_id,p_owner,false),false) then raise exception 'Owner access required.'; end if;
 perform 1 from campaign_wallets where salon_id=s.salon_id for update;
 select * into s from campaign_card_setups where id=p_setup for update;
 if s.status='completed' then return; end if;
 if s.status<>'pending' or s.created_at<now()-interval '1 day' then raise exception 'Reopen payment methods to save your card.'; end if;
 if s.payment_revision<>(select payment_revision from campaign_wallets where salon_id=s.salon_id) then raise exception 'A newer payment choice was saved. Reopen payment methods.'; end if;
 update campaign_wallets set stripe_customer=p_customer,stripe_payment_method=p_method,payment_owner=p_owner,
 auto_topup_enabled=false,auto_topup_consent_at=null,payment_revision=payment_revision+1,updated_at=now() where salon_id=s.salon_id;
 update campaign_card_setups set status='completed' where id=p_setup;
end $$;

-- Keep existing locks, idempotency and monthly limits; add the explicit payment block.
alter function public.campaign_credit_order(uuid,uuid,integer,boolean) rename to campaign_credit_order_before_workspace;
create function public.campaign_credit_order(p_salon uuid,p_owner uuid,p_amount integer,p_auto boolean default false) returns uuid
language plpgsql security definer set search_path=public as $$
declare oid uuid; w campaign_wallets; monthly integer;
begin
 if not coalesce(lifecycle_user_is_salon_owner(p_salon,p_owner,false),false) then raise exception 'Owner access required.'; end if;
 perform 1 from campaign_wallets where salon_id=p_salon for update;
 if exists(select 1 from campaign_wallets where salon_id=p_salon and payment_blocked) then raise exception 'Payments are blocked. Update payment methods first.'; end if;
 oid:=campaign_credit_order_before_workspace(p_salon,p_owner,p_amount,p_auto);
 if oid is not null then update campaign_credit_orders set payment_revision=(select payment_revision from campaign_wallets where salon_id=p_salon) where id=oid and payment_revision is null; end if;
 if oid is null and p_auto then
  select * into w from campaign_wallets where salon_id=p_salon;
  select coalesce(sum(amount_cents),0) into monthly from campaign_credit_orders where salon_id=p_salon and automatic and status in ('paid','pending','processing') and created_at>=date_trunc('month',now() at time zone 'America/Chicago') at time zone 'America/Chicago';
  if w.auto_topup_enabled and w.available_credits<=w.threshold_credits and monthly+p_amount>w.monthly_limit_cents then
   perform campaign_credit_notice(p_salon,'monthly:'||to_char(now() at time zone 'America/Chicago','YYYY-MM'),'Automatic credit limit reached','No more automatic credits will be purchased within this monthly limit. Review your limit in Settings.','/campaigns?tab=settings');
  end if;
 end if;
 return oid;
end $$;
-- A late paid checkout still grants purchased credits, but must never replace a newer or blocked saved card.
alter function public.campaign_credit_paid(uuid,text,integer,text,text) rename to campaign_credit_paid_before_workspace;
create function public.campaign_credit_paid(p_order uuid,p_reference text,p_amount integer,p_customer text default null,p_method text default null) returns void
language plpgsql security definer set search_path=public as $$
declare w campaign_wallets; o campaign_credit_orders;
begin
 select * into w from campaign_wallets where salon_id=(select salon_id from campaign_credit_orders where id=p_order) for update;
 select * into o from campaign_credit_orders where id=p_order for update;
 if w.payment_blocked or coalesce(o.payment_revision,0)<>w.payment_revision then p_method:=null; end if;
 perform campaign_credit_paid_before_workspace(p_order,p_reference,p_amount,p_customer,p_method);
end $$;
alter function public.campaign_credit_claim(uuid) rename to campaign_credit_claim_before_workspace;
create function public.campaign_credit_claim(p_order uuid) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform 1 from campaign_wallets where salon_id=(select salon_id from campaign_credit_orders where id=p_order) for update;
 if exists(select 1 from campaign_wallets where salon_id=(select salon_id from campaign_credit_orders where id=p_order) and payment_blocked) then return null; end if;
 return campaign_credit_claim_before_workspace(p_order);
end $$;
alter function public.campaign_credit_preferences(uuid,uuid,boolean,integer,integer,integer) rename to campaign_credit_preferences_before_workspace;
create function public.campaign_credit_preferences(p_salon uuid,p_owner uuid,p_enabled boolean,p_amount integer,p_threshold integer,p_limit integer) returns void
language plpgsql security definer set search_path=public as $$
begin
 perform 1 from campaign_wallets where salon_id=p_salon for update;
 if p_enabled and exists(select 1 from campaign_wallets where salon_id=p_salon and payment_blocked) then raise exception 'Allow payments before turning on automatic purchases.'; end if;
 perform campaign_credit_preferences_before_workspace(p_salon,p_owner,p_enabled,p_amount,p_threshold,p_limit);
 if not p_enabled then
  update owner_campaigns set auto_fund=false where salon_id=p_salon;
  update campaign_credit_orders set status='cancelled' where salon_id=p_salon and automatic and status='pending';
 end if;
end $$;
-- Renew only the chosen per-period ceiling, preserving the existing delivery price.
do $$begin
 execute replace(pg_get_functiondef('public.campaign_credit_renew(uuid)'::regprocedure),'cost:=c.daily_price_cents*c.days;','cost:=coalesce(c.cycle_credit_limit,c.daily_price_cents*c.days);');
 execute replace(pg_get_functiondef('public.campaign_credit_order_before_workspace(uuid,uuid,integer,boolean)'::regprocedure),
 '(w.available_credits>w.threshold_credits and not exists',
 '(w.available_credits>w.threshold_credits and not exists(select 1 from public.owner_campaigns a where a.salon_id=p_salon and a.owner_id=p_owner and a.auto_fund and a.status=''awaiting_payment'' and a.total_price_cents>w.available_credits) and not exists');
end $$;

create function public.campaign_credit_notice(p_salon uuid,p_key text,p_title text,p_body text,p_href text)
returns void language plpgsql security definer set search_path=public as $$
declare recipient uuid;
begin
 for recipient in select payment_owner from campaign_wallets where salon_id=p_salon and payment_owner is not null
 union select owner_id from owner_campaigns where salon_id=p_salon loop
  if coalesce(lifecycle_user_is_salon_owner(p_salon,recipient,false),false) then
   insert into app_notifications(account_id,salon_id,recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
   select account_id,p_salon,recipient,'owner_manager','campaign_credits',p_title,p_body,p_href,'campaign:'||p_key||':'||recipient from locations where id=p_salon
   on conflict(recipient_user_id,event_key) where event_key is not null do nothing;
  end if;
 end loop;
end $$;
create function public.campaign_credit_notices() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_table_name='campaign_wallets' then
  if new.installed and new.low_credit_reminders and not new.auto_topup_enabled and new.available_credits<=new.threshold_credits and old.available_credits>new.threshold_credits then
   perform campaign_credit_notice(new.salon_id,'low:'||new.updated_at,'Ad credits are running low','Add credits if you want your next ad period to continue. Ads already funded keep their reserved credits.','/campaigns?credits=needed');
  end if;
 else
  if new.automatic and new.status='paid' and old.status<>'paid' then
   perform campaign_credit_notice(new.salon_id,'paid:'||new.id,'Ad credits added automatically','Your new credits are ready to use. Review automatic purchases in Settings.','/campaigns?tab=settings');
  elsif new.automatic and (new.status='failed' or new.error is not null) and (old.error is distinct from new.error or old.status is distinct from new.status) then
   perform campaign_credit_notice(new.salon_id,'failed:'||new.id,'Automatic credit purchase needs attention','Check your payment method. No new ad period starts without enough credits.','/campaigns?payment=attention');
  end if;
 end if;
 return new;
end $$;
create trigger campaign_wallet_credit_notices after update on campaign_wallets for each row execute function campaign_credit_notices();
create trigger campaign_order_credit_notices after update on campaign_credit_orders for each row execute function campaign_credit_notices();

create function public.campaign_limit_reached() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='running' and new.spent_cents>=new.total_price_cents then new.status:='completed'; end if;
 return new;
end $$;
create trigger campaign_limit_reached before update on public.owner_campaigns for each row execute function public.campaign_limit_reached();
create function public.campaign_remaining_notice() returns trigger language plpgsql security definer set search_path=public as $$
declare w campaign_wallets; threshold integer;
begin
 select * into w from campaign_wallets where salon_id=new.salon_id;
 threshold:=greatest(1,ceil(coalesce(new.cycle_credit_limit,new.daily_price_cents*new.days)*0.2)::integer);
 if w.low_credit_reminders and not w.auto_topup_enabled and old.total_price_cents-old.spent_cents>threshold and new.total_price_cents-new.spent_cents<=threshold then
  perform campaign_credit_notice(new.salon_id,'ad-low:'||new.id||':'||new.reserved_credits,'Your ad is nearing its credit limit','Review the next period if you want to keep advertising. Adding credits does not raise this campaign limit.','/campaigns?credits=needed');
 end if;
 return new;
end $$;
create trigger campaign_remaining_notice after update of spent_cents on public.owner_campaigns for each row execute function public.campaign_remaining_notice();

revoke all on function public.campaign_credit_order_before_workspace(uuid,uuid,integer,boolean),public.campaign_credit_claim_before_workspace(uuid),public.campaign_credit_preferences_before_workspace(uuid,uuid,boolean,integer,integer,integer),public.campaign_credit_paid_before_workspace(uuid,text,integer,text,text) from public,anon,authenticated,service_role;
revoke all on function public.campaign_credit_paid(uuid,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.campaign_credit_paid(uuid,text,integer,text,text) to service_role;
revoke all on function public.campaign_credit_notice(uuid,text,text,text,text),public.campaign_credit_notices(),public.campaign_limit_reached(),public.campaign_remaining_notice() from public,anon,authenticated;
grant execute on function public.campaign_credit_notice(uuid,text,text,text,text) to service_role;
revoke all on function public.owner_campaign_daily_results(uuid,uuid,uuid,integer),public.campaign_set_credit_limit(uuid,uuid,uuid,integer,boolean),public.campaign_create_with_limit(uuid,uuid,uuid,text,uuid,text,text,text,text,text,integer,integer,integer,boolean,boolean),public.campaign_payment_controls(uuid,uuid,text),public.campaign_save_card(uuid,uuid,text,text),public.campaign_credit_order(uuid,uuid,integer,boolean),public.campaign_credit_claim(uuid),public.campaign_credit_preferences(uuid,uuid,boolean,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.owner_campaign_daily_results(uuid,uuid,uuid,integer),public.campaign_set_credit_limit(uuid,uuid,uuid,integer,boolean),public.campaign_create_with_limit(uuid,uuid,uuid,text,uuid,text,text,text,text,text,integer,integer,integer,boolean,boolean),public.campaign_payment_controls(uuid,uuid,text),public.campaign_save_card(uuid,uuid,text,text),public.campaign_credit_order(uuid,uuid,integer,boolean),public.campaign_credit_claim(uuid),public.campaign_credit_preferences(uuid,uuid,boolean,integer,integer,integer) to service_role;
commit;
