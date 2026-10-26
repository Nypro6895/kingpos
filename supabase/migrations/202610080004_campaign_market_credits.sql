begin;
alter table public.salon_market_plugins drop constraint salon_market_plugins_plugin_id_check;
alter table public.salon_market_plugins add constraint salon_market_plugins_plugin_id_check check(plugin_id in ('payroll-data-download','campaigns'));
update public.owner_campaign_settings set config=config || '{"welcomeCredits":300,"neighborhoodPricePercent":80,"zipcodePricePercent":80,"cityPricePercent":100,"statePricePercent":150,"countryPricePercent":200}';
create table public.campaign_wallets (
 salon_id uuid primary key references public.locations(id), installed boolean not null default false,
 available_credits integer not null default 0 check(available_credits>=0), reserved_credits integer not null default 0 check(reserved_credits>=0),
 welcome_credits integer not null default 0, auto_topup_enabled boolean not null default false,
 topup_credits integer not null default 500 check(topup_credits in (500,1500,5000)), threshold_credits integer not null default 100 check(threshold_credits between 0 and 5000),
 monthly_limit_cents integer not null default 3000 check(monthly_limit_cents between 500 and 100000),
 stripe_customer text, stripe_payment_method text, payment_owner uuid, auto_topup_consent_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.campaign_welcome_grants (
 salon_id uuid primary key, owner_id uuid unique not null, identity_key text unique not null,
 credits integer not null, granted_at timestamptz not null default now()
);
create table public.campaign_credit_ledger (
 id uuid primary key default gen_random_uuid(),salon_id uuid not null references public.campaign_wallets(salon_id),
 reference text unique not null,kind text not null check(kind in ('welcome','purchase','reserve','release')),
 credits integer not null,created_at timestamptz not null default now()
);
create table public.campaign_credit_orders (
 id uuid primary key default gen_random_uuid(),salon_id uuid not null references public.campaign_wallets(salon_id),
 owner_id uuid not null,credits integer not null check(credits in (500,1500,5000)),amount_cents integer not null,
 automatic boolean not null default false,status text not null default 'pending' check(status in ('pending','processing','paid','failed','cancelled')),
 provider_reference text unique,created_at timestamptz not null default now(),error text
);
create unique index campaign_credit_one_pending on public.campaign_credit_orders(salon_id) where status in ('pending','processing');
create table public.owner_campaign_creatives (
 id uuid primary key,salon_id uuid not null references public.locations(id),author_user_id uuid not null,
 title text not null check(length(title) between 1 and 120),caption text not null check(length(caption) between 1 and 2200),
 media_path text not null,created_at timestamptz not null default now()
);
alter table public.owner_campaigns drop constraint owner_campaigns_daily_price_cents_check;
alter table public.owner_campaigns add constraint owner_campaigns_daily_price_cents_check check(daily_price_cents>=1);
alter table public.owner_campaigns drop constraint owner_campaigns_source_type_check;
alter table public.owner_campaigns add constraint owner_campaigns_source_type_check check(source_type in ('salon_profile_look','salon_profile_update','beauty_post','custom'));
alter table public.owner_campaigns add column reserved_credits integer not null default 0;
alter table public.owner_campaigns add column released_credits integer not null default 0;
alter table public.owner_campaigns add column credit_view_limit integer;
alter table public.owner_campaigns add column keep_running boolean not null default false;
update public.owner_campaigns set credit_view_limit=days*daily_views;
alter table public.owner_campaigns alter column credit_view_limit set not null;
alter table public.campaign_wallets enable row level security;
alter table public.campaign_welcome_grants enable row level security;
alter table public.campaign_credit_ledger enable row level security;
alter table public.campaign_credit_orders enable row level security;
alter table public.owner_campaign_creatives enable row level security;
revoke all on public.campaign_wallets,public.campaign_welcome_grants,public.campaign_credit_ledger,public.campaign_credit_orders,public.owner_campaign_creatives from anon,authenticated;
grant all on public.campaign_wallets,public.campaign_welcome_grants,public.campaign_credit_ledger,public.campaign_credit_orders,public.owner_campaign_creatives to service_role;

create function public.campaign_plugin_installed(p_salon uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.campaign_wallets w join public.salon_market_plugins p on p.salon_id=w.salon_id and p.plugin_id='campaigns' where w.salon_id=p_salon and w.installed);
$$;
create function public.campaign_plugin_set(p_salon uuid,p_owner uuid,p_install boolean) returns integer
language plpgsql security definer set search_path=public as $$
declare bonus integer;identity text;granted integer;
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,p_owner,false),false) then raise exception 'Owner access required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('campaign-gift:'||p_owner::text,0));
 insert into public.campaign_wallets(salon_id) values(p_salon) on conflict do nothing;
 perform 1 from public.campaign_wallets where salon_id=p_salon for update;
 if p_install then
  select md5(lower(trim(coalesce(nullif(email,''),p_owner::text)))) into identity from public.users where id=p_owner;
  select greatest(0,(config->>'welcomeCredits')::integer) into bonus from public.owner_campaign_settings where id;
  insert into public.campaign_welcome_grants(salon_id,owner_id,identity_key,credits) values(p_salon,p_owner,identity,bonus) on conflict do nothing;
  get diagnostics granted=row_count;
  if granted>0 then
   update public.campaign_wallets set available_credits=available_credits+bonus,welcome_credits=bonus where salon_id=p_salon;
   insert into public.campaign_credit_ledger(salon_id,reference,kind,credits) values(p_salon,'welcome:'||p_salon,'welcome',bonus);
  end if;
  insert into public.salon_market_plugins(salon_id,plugin_id) values(p_salon,'campaigns') on conflict do nothing;
  update public.campaign_wallets set installed=true,updated_at=now() where salon_id=p_salon;
 else
  update public.campaign_wallets set installed=false,auto_topup_enabled=false,updated_at=now() where salon_id=p_salon;
  delete from public.salon_market_plugins where salon_id=p_salon and plugin_id='campaigns';
  update public.owner_campaigns set status='paused',keep_running=false,updated_at=now() where salon_id=p_salon and status='running';
  update public.owner_campaigns set keep_running=false where salon_id=p_salon;
 end if;
 return (select available_credits from public.campaign_wallets where salon_id=p_salon);
end $$;

-- Extend the existing eligibility check for independently uploaded ad creatives.
alter function public.owner_campaign_post(text,uuid,uuid) rename to owner_campaign_post_original;
create function public.owner_campaign_post(p_type text,p_source uuid,p_salon uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare item jsonb;
begin
 if not public.campaign_plugin_installed(p_salon) then return null; end if;
 if p_type<>'custom' then return public.owner_campaign_post_original(p_type,p_source,p_salon); end if;
 select to_jsonb(c) into item from public.owner_campaign_creatives c where c.id=p_source and c.salon_id=p_salon
 and exists(select 1 from public.locations l join public.accounts a on a.id=l.account_id where l.id=p_salon and l.status='active' and a.status='active')
 and exists(select 1 from public.salon_settings s where s.salon_id=p_salon and s.public_discovery_enabled)
 and public.lifecycle_user_is_salon_owner(p_salon,c.author_user_id,false);
 return item;
end $$;
create function public.campaign_credit_prepare() returns trigger language plpgsql security definer set search_path=public as $$
declare cfg jsonb;percent integer;
begin
 if not public.campaign_plugin_installed(new.salon_id) then raise exception 'Add Campaigns from Market first.'; end if;
 select config into cfg from public.owner_campaign_settings where id;
 percent:=(cfg->>(new.area||'PricePercent'))::integer;
 new.daily_price_cents:=ceil(new.daily_price_cents*percent/100.0)::integer;
 new.total_price_cents:=new.daily_price_cents*new.days;
 new.credit_view_limit:=new.days*new.daily_views;
 return new;
end $$;
create trigger campaign_credit_prepare before insert on public.owner_campaigns for each row execute function public.campaign_credit_prepare();

create function public.campaign_credit_fund(p_id uuid,p_salon uuid,p_owner uuid,p_keep boolean default false) returns text
language plpgsql security definer set search_path=public as $$
declare c public.owner_campaigns;w public.campaign_wallets;
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,p_owner,false),false) or not public.campaign_plugin_installed(p_salon) then raise exception 'Add Campaigns in your owner workspace first.'; end if;
 select * into w from public.campaign_wallets where salon_id=p_salon for update;
 select * into c from public.owner_campaigns where id=p_id and salon_id=p_salon for update;
 if c.id is null then raise exception 'Campaign not found.'; end if;
 if c.status<>'awaiting_payment' then return c.status; end if;
 if w.available_credits<c.total_price_cents then update public.owner_campaigns set keep_running=p_keep where id=p_id; return 'awaiting_payment'; end if;
 update public.campaign_wallets set available_credits=available_credits-c.total_price_cents,reserved_credits=reserved_credits+c.total_price_cents,updated_at=now() where salon_id=p_salon;
 insert into public.campaign_credit_ledger(salon_id,reference,kind,credits) values(p_salon,'reserve:'||p_id,'reserve',-c.total_price_cents);
 update public.owner_campaigns set status='pending_review',payment_reference='credits:'||p_id,reserved_credits=c.total_price_cents,keep_running=p_keep,updated_at=now() where id=p_id;
 return 'pending_review';
end $$;
create function public.campaign_credit_release() returns trigger language plpgsql security definer set search_path=public as $$
declare refund integer;
begin
 if new.status in ('cancelled','rejected','completed') and old.status is distinct from new.status and new.reserved_credits>0 then
  refund:=greatest(0,new.reserved_credits-new.spent_cents-new.released_credits);
  if refund>0 then
   update public.campaign_wallets set available_credits=available_credits+refund,reserved_credits=greatest(0,reserved_credits-refund),updated_at=now() where salon_id=new.salon_id;
   insert into public.campaign_credit_ledger(salon_id,reference,kind,credits) values(new.salon_id,'release:'||new.id||':'||new.reserved_credits,'release',refund) on conflict do nothing;
   new.released_credits:=new.released_credits+refund;
  end if;
 end if;
 return new;
end $$;
create trigger campaign_credit_release before update on public.owner_campaigns for each row execute function public.campaign_credit_release();

-- Legacy dispatch keeps its atomic view/frequency checks; reserved credits fund admitted views.
do $$begin
 execute replace(pg_get_functiondef('public.owner_campaign_admit(uuid,text,text,jsonb,uuid,uuid)'::regprocedure),'c.days*c.daily_views','c.credit_view_limit');
 execute replace(replace(pg_get_functiondef('public.owner_campaign_candidates(jsonb,text,uuid)'::regprocedure),'c.days*c.daily_views','c.credit_view_limit'),'e.days*e.daily_views','e.credit_view_limit');
end $$;
alter function public.owner_campaign_admit(uuid,text,text,jsonb,uuid,uuid) rename to owner_campaign_admit_without_wallet;
create function public.owner_campaign_admit(p_id uuid,p_visitor text,p_kind text,p_area jsonb,p_viewer uuid default null,p_nonce uuid default null) returns boolean
language plpgsql security definer set search_path=public as $$
declare sid uuid;previous integer;current_spend integer;accepted boolean;
begin
 select salon_id into sid from public.owner_campaigns where id=p_id;
 if not public.campaign_plugin_installed(sid) then return false; end if;
 perform 1 from public.campaign_wallets where salon_id=sid for update;
 select spent_cents into previous from public.owner_campaigns where id=p_id and reserved_credits-released_credits>spent_cents for update;
 if previous is null then return false; end if;
 accepted:=public.owner_campaign_admit_without_wallet(p_id,p_visitor,p_kind,p_area,p_viewer,p_nonce);
 select spent_cents into current_spend from public.owner_campaigns where id=p_id;
 if current_spend>previous then update public.campaign_wallets set reserved_credits=greatest(0,reserved_credits-(current_spend-previous)),updated_at=now() where salon_id=sid; end if;
 return accepted;
end $$;

create function public.campaign_credit_preferences(p_salon uuid,p_owner uuid,p_enabled boolean,p_amount integer,p_threshold integer,p_limit integer) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,p_owner,false),false) or not public.campaign_plugin_installed(p_salon) then raise exception 'Owner access required.'; end if;
 if p_amount not in (500,1500,5000) or p_threshold not between 0 and 5000 or p_limit not between p_amount and 100000 then raise exception 'Choose a top-up amount and a monthly limit that covers it.'; end if;
 if p_enabled and not exists(select 1 from public.campaign_wallets where salon_id=p_salon and stripe_payment_method is not null and payment_owner=p_owner) then raise exception 'Add your payment method before turning on automatic top-ups.'; end if;
 update public.campaign_wallets set auto_topup_enabled=p_enabled,topup_credits=p_amount,threshold_credits=p_threshold,monthly_limit_cents=p_limit,
 auto_topup_consent_at=case when p_enabled then now() else null end,updated_at=now() where salon_id=p_salon;
end $$;
create function public.campaign_credit_order(p_salon uuid,p_owner uuid,p_amount integer,p_auto boolean default false) returns uuid
language plpgsql security definer set search_path=public as $$
declare w public.campaign_wallets;oid uuid;monthly integer;
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,p_owner,false),false) or not public.campaign_plugin_installed(p_salon) then raise exception 'Owner access required.'; end if;
 select * into w from public.campaign_wallets where salon_id=p_salon for update;
 if p_amount not in (500,1500,5000) then raise exception 'Choose an available credit pack.'; end if;
 select id into oid from public.campaign_credit_orders where salon_id=p_salon and status in ('pending','processing');
 if oid is not null then return oid; end if;
 if p_auto then
  if not coalesce((select (config->>'enabled')::boolean from public.owner_campaign_settings where id),false) then return null; end if;
  if not w.auto_topup_enabled or w.payment_owner is distinct from p_owner or w.stripe_payment_method is null or (w.available_credits>w.threshold_credits and not exists(select 1 from public.owner_campaigns c where c.salon_id=p_salon and c.keep_running and c.status in ('running','completed') and c.ends_at<=now() and c.daily_price_cents*c.days>w.available_credits)) or w.topup_credits<>p_amount then return null; end if;
  select coalesce(sum(amount_cents),0) into monthly from public.campaign_credit_orders where salon_id=p_salon and automatic and status in ('paid','processing','pending') and created_at>=date_trunc('month',now() at time zone 'America/Chicago') at time zone 'America/Chicago';
  if monthly+p_amount>w.monthly_limit_cents then return null; end if;
 end if;
 insert into public.campaign_credit_orders(salon_id,owner_id,credits,amount_cents,automatic) values(p_salon,p_owner,p_amount,p_amount,p_auto) returning id into oid;
 return oid;
end $$;
create function public.campaign_credit_paid(p_order uuid,p_reference text,p_amount integer,p_customer text default null,p_method text default null) returns void
language plpgsql security definer set search_path=public as $$
declare o public.campaign_credit_orders;
begin
 perform 1 from public.campaign_wallets where salon_id=(select salon_id from public.campaign_credit_orders where id=p_order) for update;
 select * into o from public.campaign_credit_orders where id=p_order for update;
 if o.id is null or p_amount is distinct from o.amount_cents or nullif(trim(p_reference),'') is null then raise exception 'Payment does not match this credit pack.'; end if;
 if o.status='paid' then if o.provider_reference=p_reference then return; else raise exception 'Payment already recorded.'; end if; end if;
 insert into public.campaign_credit_ledger(salon_id,reference,kind,credits) values(o.salon_id,'purchase:'||p_reference,'purchase',o.credits);
 update public.campaign_wallets set available_credits=available_credits+o.credits,
 auto_topup_enabled=case when p_method is not null and payment_owner is distinct from o.owner_id then false else auto_topup_enabled end,
 auto_topup_consent_at=case when p_method is not null and payment_owner is distinct from o.owner_id then null else auto_topup_consent_at end,
 stripe_customer=case when p_method is not null then p_customer else stripe_customer end,stripe_payment_method=coalesce(p_method,stripe_payment_method),payment_owner=case when p_method is not null then o.owner_id else payment_owner end,updated_at=now() where salon_id=o.salon_id;
 update public.campaign_credit_orders set status='paid',provider_reference=p_reference where id=p_order;
end $$;

create function public.campaign_credit_renew(p_id uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare c public.owner_campaigns;w public.campaign_wallets;cost integer;sid uuid;
begin
 select salon_id into sid from public.owner_campaigns where id=p_id;
 select * into w from public.campaign_wallets where salon_id=sid for update;
 select * into c from public.owner_campaigns where id=p_id for update;
 if not coalesce((select (config->>'enabled')::boolean from public.owner_campaign_settings where id),false) then return false; end if;
 if c.id is null or not c.keep_running or c.status not in ('running','completed') or c.ends_at>now() or not public.campaign_plugin_installed(sid) or public.owner_campaign_post(c.source_type,c.source_id,sid) is null then return false; end if;
 if c.status='running' then
  update public.owner_campaigns set status='completed' where id=p_id;
  select * into c from public.owner_campaigns where id=p_id;
  select * into w from public.campaign_wallets where salon_id=sid;
 end if;
 if exists(select 1 from public.owner_campaigns other where other.id<>c.id and other.salon_id=sid and other.source_type=c.source_type and other.source_id=c.source_id and other.status in ('awaiting_payment','pending_review','running','paused')) then update public.owner_campaigns set keep_running=false where id=p_id; return false; end if;
 cost:=c.daily_price_cents*c.days;
 if w.available_credits<cost then
  update public.owner_campaigns set status='completed',updated_at=now() where id=p_id; return false;
 end if;
 update public.campaign_wallets set available_credits=available_credits-cost,reserved_credits=reserved_credits+cost where salon_id=sid;
 insert into public.campaign_credit_ledger(salon_id,reference,kind,credits) values(sid,'renew:'||c.id||':'||c.reserved_credits,'reserve',-cost);
 update public.owner_campaigns set status='running',starts_at=now(),ends_at=now()+make_interval(days=>c.days),total_price_cents=reserved_credits-released_credits+cost,
 reserved_credits=reserved_credits+cost,credit_view_limit=views+c.days*c.daily_views,updated_at=now() where id=p_id;
 return true;
end $$;

revoke all on function public.owner_campaign_post_original(text,uuid,uuid),public.owner_campaign_admit_without_wallet(uuid,text,text,jsonb,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.campaign_plugin_installed(uuid),public.campaign_plugin_set(uuid,uuid,boolean),public.owner_campaign_post(text,uuid,uuid),public.campaign_credit_prepare(),public.campaign_credit_fund(uuid,uuid,uuid,boolean),public.campaign_credit_release(),public.owner_campaign_admit(uuid,text,text,jsonb,uuid,uuid),public.campaign_credit_preferences(uuid,uuid,boolean,integer,integer,integer),public.campaign_credit_order(uuid,uuid,integer,boolean),public.campaign_credit_paid(uuid,text,integer,text,text),public.campaign_credit_renew(uuid) from public,anon,authenticated;
grant execute on function public.campaign_plugin_installed(uuid),public.campaign_plugin_set(uuid,uuid,boolean),public.owner_campaign_post(text,uuid,uuid),public.campaign_credit_fund(uuid,uuid,uuid,boolean),public.owner_campaign_admit(uuid,text,text,jsonb,uuid,uuid),public.campaign_credit_preferences(uuid,uuid,boolean,integer,integer,integer),public.campaign_credit_order(uuid,uuid,integer,boolean),public.campaign_credit_paid(uuid,text,integer,text,text),public.campaign_credit_renew(uuid) to service_role;


alter function public.owner_campaign_create(uuid,uuid,uuid,text,uuid,text,text,text,text,text,integer,integer) rename to owner_campaign_create_original;
create function public.owner_campaign_create(p_id uuid,p_salon uuid,p_user uuid,p_type text,p_source uuid,p_area text,p_location text,p_country text,p_state text,p_city text,p_views integer,p_days integer) returns uuid language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.campaign_wallets where salon_id=p_salon for update;
 return public.owner_campaign_create_original(p_id,p_salon,p_user,p_type,p_source,p_area,p_location,p_country,p_state,p_city,p_views,p_days);
end $$;
revoke all on function public.owner_campaign_create_original(uuid,uuid,uuid,text,uuid,text,text,text,text,text,integer,integer) from public,anon,authenticated,service_role;
revoke all on function public.owner_campaign_create(uuid,uuid,uuid,text,uuid,text,text,text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.owner_campaign_create(uuid,uuid,uuid,text,uuid,text,text,text,text,text,integer,integer) to service_role;
create function public.campaign_credit_claim(p_order uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare w public.campaign_wallets;o public.campaign_credit_orders;
begin
 select * into w from public.campaign_wallets where salon_id=(select salon_id from public.campaign_credit_orders where id=p_order) for update;
 select * into o from public.campaign_credit_orders where id=p_order for update;
 if not coalesce((select (config->>'enabled')::boolean from public.owner_campaign_settings where id),false) then return null; end if;
 if o.id is null or not o.automatic or o.status not in ('pending','processing') or not w.auto_topup_enabled or not public.campaign_plugin_installed(w.salon_id) or w.payment_owner is distinct from o.owner_id or w.topup_credits<>o.credits or w.stripe_payment_method is null then return null; end if;
 if (select coalesce(sum(amount_cents),0) from public.campaign_credit_orders where salon_id=w.salon_id and automatic and status in ('paid','pending','processing') and created_at>=date_trunc('month',now() at time zone 'America/Chicago') at time zone 'America/Chicago')>w.monthly_limit_cents then return null; end if;
 update public.campaign_credit_orders set status='processing' where id=p_order;
 return jsonb_build_object('customer',w.stripe_customer,'method',w.stripe_payment_method,'amount',o.amount_cents);
end $$;
revoke all on function public.campaign_credit_claim(uuid) from public,anon,authenticated;
grant execute on function public.campaign_credit_claim(uuid) to service_role;

alter function public.owner_campaign_change(uuid,uuid,uuid,text) rename to owner_campaign_change_original;
create function public.owner_campaign_change(p_id uuid,p_salon uuid,p_user uuid,p_action text) returns void language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.campaign_wallets where salon_id=p_salon for update;
 perform public.owner_campaign_change_original(p_id,p_salon,p_user,p_action);
end $$;
alter function public.owner_campaign_review(uuid,boolean) rename to owner_campaign_review_original;
create function public.owner_campaign_review(p_id uuid,p_approve boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.campaign_wallets where salon_id=(select salon_id from public.owner_campaigns where id=p_id) for update;
 if not exists(select 1 from public.owner_campaigns where id=p_id and reserved_credits>0) then raise exception 'Reserve credits before submitting this ad.'; end if;
 perform public.owner_campaign_review_original(p_id,p_approve);
end $$;
create function public.campaign_credit_close_expired(p_salon uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.campaign_wallets where salon_id=p_salon for update;
 update public.owner_campaigns set status='completed',updated_at=now() where salon_id=p_salon and status in ('running','paused') and ends_at<=now() and not (keep_running and status='running' and public.campaign_plugin_installed(p_salon) and coalesce((select (config->>'enabled')::boolean from public.owner_campaign_settings where id),false));
end $$;
revoke all on function public.owner_campaign_confirm_payment(uuid,text,integer),public.owner_campaign_change_original(uuid,uuid,uuid,text),public.owner_campaign_review_original(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.owner_campaign_change(uuid,uuid,uuid,text),public.owner_campaign_review(uuid,boolean),public.campaign_credit_close_expired(uuid) from public,anon,authenticated;
grant execute on function public.owner_campaign_change(uuid,uuid,uuid,text),public.owner_campaign_review(uuid,boolean),public.campaign_credit_close_expired(uuid) to service_role;


create function public.campaign_custom_booking_conversion() returns trigger language plpgsql security definer set search_path=public as $$
declare item jsonb:=to_jsonb(new);cid uuid;actor uuid;accepted integer;
begin
 if item->>'confirmation_status' is distinct from 'confirmed' or item->>'status' not in ('confirmed','checked_in','in_service','completed') or nullif(item->>'source_reference_id','') is not null then return new; end if;
 actor:=nullif(item->>'customer_user_id','')::uuid;
 select a.campaign_id into cid from public.owner_campaign_attribution a join public.owner_campaigns c on c.id=a.campaign_id
 where a.user_id=actor and a.source_type='custom' and c.salon_id::text=item->>'salon_id' and a.clicked_at>now()-interval '7 days'
 and not coalesce(public.lifecycle_user_is_salon_owner(c.salon_id,actor,true),false)
 and (item->>'created_at' is null or (item->>'created_at')::timestamptz>=a.clicked_at)
 order by a.clicked_at desc limit 1;
 if cid is null then return new; end if;
 insert into public.owner_campaign_conversions(campaign_id,user_id,kind,evidence_id) values(cid,actor,'book',(item->>'id')::uuid) on conflict do nothing;
 get diagnostics accepted=row_count;
 if accepted>0 then update public.owner_campaigns set bookings=bookings+1 where id=cid; end if;
 return new;
end $$;
revoke all on function public.campaign_custom_booking_conversion() from public,anon,authenticated;
create trigger campaign_custom_booking_conversion after insert or update on public.bookings for each row execute function public.campaign_custom_booking_conversion();

-- Store only validated, re-encoded images; owners receive scoped signed upload paths.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('campaign-creatives','campaign-creatives',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
commit;
