begin;
create table public.owner_campaign_settings (
 id boolean primary key default true check(id), config jsonb not null,
 updated_at timestamptz not null default now()
);
insert into public.owner_campaign_settings(config) values ('{"enabled":true,"promptsEnabled":true,"dailyPriceCents":100,"viewsPerDollar":500,"maxDays":30,"maxCampaigns":5,"promptCooldownHours":24,"dailyFrequency":2,"maxDailyViews":10000,"maxAdsPerDay":6,"exampleLikesPerThousand":69,"exampleCommentsPerThousand":10,"exampleBookingsPerThousand":3}');
create table public.owner_campaigns (
 id uuid primary key, salon_id uuid not null references public.locations(id),
 owner_id uuid not null references public.users(id), source_type text not null check(source_type in ('salon_profile_look','salon_profile_update','beauty_post')),
 source_id uuid not null, title text not null, area text not null check(area in ('city','neighborhood','zipcode','state','country')),
 location text not null, country text not null, state text not null default '', city text not null default '',
 days integer not null check(days between 1 and 90), daily_views integer not null check(daily_views between 100 and 100000),
 daily_price_cents integer not null check(daily_price_cents>=100), total_price_cents integer not null check(total_price_cents>0),
 status text not null default 'awaiting_payment' check(status in ('awaiting_payment','pending_review','running','paused','cancelled','completed','rejected')),
 payment_reference text unique, approved_at timestamptz, starts_at timestamptz, ends_at timestamptz,
 views integer not null default 0, clicks integer not null default 0, likes integer not null default 0,
 comments integer not null default 0, bookings integer not null default 0, spent_cents integer not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index owner_campaign_salon on public.owner_campaigns(salon_id,created_at desc);
create unique index owner_campaign_active_post on public.owner_campaigns(salon_id,source_type,source_id) where status in ('awaiting_payment','pending_review','running','paused');
create table public.owner_campaign_prompts (
 id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.locations(id),
 source_type text not null, source_id uuid not null, title text not null,
 claimed_by uuid references public.users(id), claimed_at timestamptz, dismissed_at timestamptz,
 created_at timestamptz not null default now(), unique(source_type,source_id)
);
create table public.owner_campaign_events (
 campaign_id uuid not null references public.owner_campaigns(id), visitor_hash text not null,
 day date not null, kind text not null check(kind in ('view','click','like','comment','book')),
 ordinal integer not null default 1 check(ordinal>0), nonce uuid, created_at timestamptz not null default now(),
 primary key(campaign_id,visitor_hash,day,kind,ordinal)
);
create unique index owner_campaign_event_ticket on public.owner_campaign_events(campaign_id,visitor_hash,nonce,kind) where nonce is not null;
create index owner_campaign_daily_events on public.owner_campaign_events(campaign_id,day,kind);
alter table public.owner_campaign_settings enable row level security;
alter table public.owner_campaigns enable row level security;
alter table public.owner_campaign_prompts enable row level security;
alter table public.owner_campaign_events enable row level security;
revoke all on public.owner_campaign_settings,public.owner_campaigns,public.owner_campaign_prompts,public.owner_campaign_events from anon,authenticated;
grant all on public.owner_campaign_settings,public.owner_campaigns,public.owner_campaign_prompts,public.owner_campaign_events to service_role;


create table public.owner_campaign_attribution (
 user_id uuid not null references public.users(id),source_type text not null,source_id uuid not null,
 campaign_id uuid not null references public.owner_campaigns(id), clicked_at timestamptz not null default now(),
 primary key(user_id,source_type,source_id)
);
create table public.owner_campaign_conversions (
 campaign_id uuid not null references public.owner_campaigns(id),user_id uuid not null references public.users(id),
 kind text not null check(kind in ('like','comment','book')),evidence_id uuid not null,created_at timestamptz not null default now(),
 primary key(campaign_id,user_id,kind)
);
alter table public.owner_campaign_attribution enable row level security;
alter table public.owner_campaign_conversions enable row level security;
revoke all on public.owner_campaign_attribution,public.owner_campaign_conversions from anon,authenticated;
grant all on public.owner_campaign_attribution,public.owner_campaign_conversions to service_role;

-- Check the current post at creation, approval and every admitted view.
create function public.owner_campaign_post(p_type text,p_source uuid,p_salon uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare item jsonb; tbl text:=public.post_safety_table(p_type);
begin
 if tbl is null then return null; end if;
 execute format('select to_jsonb(p) from public.%I p where id=$1',tbl) into item using p_source;
 if item is null or item->>'salon_id' is distinct from p_salon::text or coalesce((item->>'safety_hold')::boolean,false) or item->>'deleted_at' is not null then return null; end if;
 if p_type='beauty_post' then
  if item->>'visibility' is distinct from 'public' or item->>'moderation_status' is distinct from 'visible' then return null; end if;
 elsif item->>'status' is distinct from 'published' then return null;
 end if;
 if not exists(select 1 from public.locations l join public.accounts a on a.id=l.account_id where l.id=p_salon and l.status='active' and a.status='active') then return null; end if;
 if not exists(select 1 from public.salon_settings where salon_id=p_salon and public_discovery_enabled) then return null; end if;
 if p_type='beauty_post' and not exists(select 1 from public.beauty_profiles where id=(item->>'profile_id')::uuid and visibility='public') then return null; end if;
 return item;
end $$;

create function public.owner_campaign_enqueue() returns trigger
language plpgsql security definer set search_path=public as $$
declare item jsonb:=to_jsonb(new); kind text; sid uuid;
begin
 sid:=nullif(item->>'salon_id','')::uuid;
 kind:=case tg_table_name when 'beauty_posts' then 'beauty_post' when 'salon_profile_looks' then 'salon_profile_look' else 'salon_profile_update' end;
 if sid is not null and public.owner_campaign_post(kind,(item->>'id')::uuid,sid) is not null then
  insert into public.owner_campaign_prompts(salon_id,source_type,source_id,title)
  values(sid,kind,(item->>'id')::uuid,left(coalesce(nullif(item->>'title',''),nullif(item->>'caption',''),'Your new post'),120)) on conflict do nothing;
 end if;
 return new;
end $$;
create trigger owner_campaign_enqueue after insert or update on public.salon_profile_looks for each row execute function public.owner_campaign_enqueue();
create trigger owner_campaign_enqueue after insert or update on public.salon_profile_updates for each row execute function public.owner_campaign_enqueue();
create trigger owner_campaign_enqueue after insert or update on public.beauty_posts for each row execute function public.owner_campaign_enqueue();

create function public.owner_campaign_claim_prompt(p_salon uuid,p_user uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare prompt public.owner_campaign_prompts; cfg jsonb;
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,p_user,false),false) then raise exception 'Owner access required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('campaign-prompt:'||p_user::text,0));
 select config into cfg from public.owner_campaign_settings where id;
 if not (cfg->>'enabled')::boolean or not (cfg->>'promptsEnabled')::boolean then return null; end if;
 if exists(select 1 from public.owner_campaign_prompts where claimed_by=p_user and claimed_at>now()-make_interval(hours=>(cfg->>'promptCooldownHours')::integer)) then return null; end if;
 select * into prompt from public.owner_campaign_prompts p where salon_id=p_salon and claimed_at is null and dismissed_at is null
  and created_at>now()-interval '24 hours' and public.owner_campaign_post(source_type,source_id,salon_id) is not null
  and (public.owner_campaign_post(source_type,source_id,salon_id)->>'author_user_id'=p_user::text or public.owner_campaign_post(source_type,source_id,salon_id)->>'created_by_user_id'=p_user::text)
  and not exists(select 1 from public.owner_campaigns c where c.salon_id=p_salon and c.source_type=p.source_type and c.source_id=p.source_id and c.status in ('awaiting_payment','pending_review','running','paused'))
  order by created_at desc limit 1 for update skip locked;
 if prompt.id is null then return null; end if;
 update public.owner_campaign_prompts set claimed_at=now(),claimed_by=p_user where id=prompt.id;
 return jsonb_build_object('id',prompt.id,'target',jsonb_build_object('sourceId',prompt.source_id,'sourceType',prompt.source_type,'salonId',p_salon,'title',prompt.title));
end $$;

create function public.owner_campaign_create(p_id uuid,p_salon uuid,p_user uuid,p_type text,p_source uuid,p_area text,p_location text,p_country text,p_state text,p_city text,p_views integer,p_days integer) returns uuid
language plpgsql security definer set search_path=public as $$
declare cfg jsonb; item jsonb; price integer; existing public.owner_campaigns;
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,p_user,false),false) then raise exception 'Owner access required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('campaign:'||p_salon::text,0));
 select * into existing from public.owner_campaigns where id=p_id;
 if existing.id is not null then
  if existing.salon_id=p_salon and existing.owner_id=p_user and existing.source_type=p_type and existing.source_id=p_source then return existing.id; end if;
  raise exception 'Please reopen the campaign.';
 end if;
 update public.owner_campaigns set status='completed',updated_at=now() where salon_id=p_salon and status in ('running','paused') and ends_at<=now();
 select config into cfg from public.owner_campaign_settings where id for share;
 if not (cfg->>'enabled')::boolean then raise exception 'New campaigns are temporarily unavailable.'; end if;
 item:=public.owner_campaign_post(p_type,p_source,p_salon);
 if item is null then raise exception 'Choose a published post from this salon.'; end if;
 if p_type='beauty_post' and item->>'author_user_id' is distinct from p_user::text then raise exception 'Choose your own published Beauty post.'; end if;
 if p_days not between 1 and (cfg->>'maxDays')::integer or p_views not between 100 and (cfg->>'maxDailyViews')::integer then raise exception 'Choose an available duration and daily view limit.'; end if;
 if p_area not in ('city','neighborhood','zipcode','state','country') or length(trim(p_location)) not between 1 and 120 or length(trim(p_country)) not between 1 and 80 or length(p_state)>120 or length(p_city)>120 then raise exception 'Choose a valid area and country.'; end if;
 if p_area in ('city','neighborhood','zipcode') and trim(p_state)='' then raise exception 'Add the state or region.'; end if;
 if p_area='neighborhood' and trim(p_city)='' then raise exception 'Add the city.'; end if;
 if (select count(*) from public.owner_campaigns where salon_id=p_salon and status in ('awaiting_payment','pending_review','running','paused')) >= (cfg->>'maxCampaigns')::integer then raise exception 'Cancel or finish an existing campaign before adding another.'; end if;
 if exists(select 1 from public.owner_campaigns where salon_id=p_salon and source_type=p_type and source_id=p_source and status in ('awaiting_payment','pending_review','running','paused')) then raise exception 'This post already has a campaign. Open it in Campaigns.'; end if;
 price:=greatest((cfg->>'dailyPriceCents')::integer,ceil(p_views*100.0/(cfg->>'viewsPerDollar')::integer)::integer);
 insert into public.owner_campaigns(id,salon_id,owner_id,source_type,source_id,title,area,location,country,state,city,days,daily_views,daily_price_cents,total_price_cents)
 values(p_id,p_salon,p_user,p_type,p_source,left(coalesce(nullif(item->>'title',''),nullif(item->>'caption',''),'Your post'),120),p_area,trim(p_location),trim(p_country),trim(p_state),trim(p_city),p_days,p_views,price,price*p_days);
 update public.owner_campaign_prompts set dismissed_at=now() where salon_id=p_salon and source_type=p_type and source_id=p_source;
 return p_id;
end $$;

create function public.owner_campaign_change(p_id uuid,p_salon uuid,p_user uuid,p_action text) returns void
language plpgsql security definer set search_path=public as $$
declare c public.owner_campaigns;
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,p_user,false),false) then raise exception 'Owner access required.'; end if;
 select * into c from public.owner_campaigns where id=p_id and salon_id=p_salon for update;
 if c.id is null then raise exception 'Campaign not found.'; end if;
 if p_action='cancel' and c.status in ('awaiting_payment','pending_review','running','paused') then
  update public.owner_campaigns set status='cancelled',updated_at=now() where id=p_id;
 elsif p_action='pause' and c.status='running' then
  update public.owner_campaigns set status='paused',updated_at=now() where id=p_id;
 elsif p_action='resume' and c.status='paused' and c.ends_at>now() and c.payment_reference is not null and c.approved_at is not null and public.owner_campaign_post(c.source_type,c.source_id,c.salon_id) is not null then
  update public.owner_campaigns set status='running',updated_at=now() where id=p_id;
 else raise exception 'This campaign cannot be changed. Its scheduled end date stays the same while paused.';
 end if;
end $$;

-- Future payment webhook calls this only after verifying the provider signature and USD payment.
-- Owner requests cannot call payment confirmation or approval directly.
create function public.owner_campaign_confirm_payment(p_id uuid,p_reference text,p_amount integer) returns void
language plpgsql security definer set search_path=public as $$
declare c public.owner_campaigns;
begin
 select * into c from public.owner_campaigns where id=p_id for update;
 if c.id is null or length(trim(p_reference)) not between 1 and 200 or p_amount<>c.total_price_cents then raise exception 'Payment does not match campaign.'; end if;
 if c.payment_reference=p_reference then return; end if;
 if c.status<>'awaiting_payment' then raise exception 'Campaign is no longer awaiting payment.'; end if;
 update public.owner_campaigns set payment_reference=p_reference,status='pending_review',updated_at=now() where id=p_id;
end $$;
create function public.owner_campaign_review(p_id uuid,p_approve boolean) returns void
language plpgsql security definer set search_path=public as $$
declare c public.owner_campaigns;
begin
 select * into c from public.owner_campaigns where id=p_id for update;
 if c.status is distinct from 'pending_review' or c.payment_reference is null then raise exception 'Only paid campaigns awaiting review can be approved.'; end if;
 if p_approve and (public.owner_campaign_post(c.source_type,c.source_id,c.salon_id) is null or not coalesce(public.lifecycle_user_is_salon_owner(c.salon_id,c.owner_id,false),false)) then raise exception 'Post is no longer available.'; end if;
 update public.owner_campaigns set status=case when p_approve then 'running' else 'rejected' end,
  approved_at=case when p_approve then now() end,starts_at=case when p_approve then now() end,
  ends_at=case when p_approve then now()+make_interval(days=>c.days) end,updated_at=now() where id=p_id;
end $$;

-- One locked admission accounts for all simultaneous tabs/devices; no billing from estimates.
create function public.owner_campaign_admit(p_id uuid,p_visitor text,p_kind text,p_area jsonb,p_viewer uuid default null,p_nonce uuid default null) returns boolean
language plpgsql security definer set search_path=public as $$
declare c public.owner_campaigns; cfg jsonb; today date:=(now() at time zone 'America/Chicago')::date;
 daily integer; frequency integer; admitted integer; matched boolean; elapsed integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('campaign-visitor:'||p_visitor,0));
 if p_kind not in ('view','click','like','comment','book') or length(p_visitor)<>64 then return false; end if;
 select * into c from public.owner_campaigns where id=p_id for update;
 select config into cfg from public.owner_campaign_settings where id;
 if c.id is null or not (cfg->>'enabled')::boolean or c.status<>'running' or c.payment_reference is null or c.approved_at is null or c.starts_at>now() then return false; end if;
 if c.ends_at<=now() or c.views>=c.days*c.daily_views or c.spent_cents>=c.total_price_cents then
  update public.owner_campaigns set status='completed',updated_at=now() where id=p_id; return false;
 end if;
 if public.owner_campaign_post(c.source_type,c.source_id,c.salon_id) is null or not coalesce(public.lifecycle_user_is_salon_owner(c.salon_id,c.owner_id,false),false) then
  update public.owner_campaigns set status='paused',updated_at=now() where id=p_id; return false;
 end if;
 if p_viewer is not null and public.lifecycle_user_is_salon_owner(c.salon_id,p_viewer,true) then return false; end if;
 matched:=lower(trim(c.country))=lower(trim(p_area->>'country')) and
  (c.area='country' and lower(trim(c.location))=lower(trim(p_area->>'country')) or
   c.area='state' and lower(trim(c.location))=lower(trim(p_area->>'state')) or
   c.area='city' and lower(trim(c.state))=lower(trim(p_area->>'state')) and lower(trim(c.location))=lower(trim(p_area->>'city')) or
   c.area='zipcode' and lower(trim(c.state))=lower(trim(p_area->>'state')) and lower(trim(c.location))=lower(trim(p_area->>'zipcode')) or
   c.area='neighborhood' and lower(trim(c.state))=lower(trim(p_area->>'state')) and lower(trim(c.city))=lower(trim(p_area->>'city')) and lower(trim(c.location))=lower(trim(p_area->>'neighborhood')));
 if not coalesce(matched,false) then return false; end if;
 if p_nonce is not null and exists(select 1 from public.owner_campaign_events where campaign_id=p_id and visitor_hash=p_visitor and nonce=p_nonce and kind=p_kind) then return true; end if;
 if p_kind='view' then
  if (select count(*) from public.owner_campaign_events where visitor_hash=p_visitor and day=today and kind='view') >= coalesce((cfg->>'maxAdsPerDay')::integer,6) then return false; end if;
  select count(*) into daily from public.owner_campaign_events where campaign_id=p_id and day=today and kind='view';
  select count(*) into frequency from public.owner_campaign_events where campaign_id=p_id and visitor_hash=p_visitor and day=today and kind='view';
  elapsed:=greatest(1,ceil(extract(epoch from now()-greatest(c.starts_at,date_trunc('day',now() at time zone 'America/Chicago') at time zone 'America/Chicago'))/86400*c.daily_views)::integer);
  if daily>=c.daily_views or daily>=elapsed or frequency>=(cfg->>'dailyFrequency')::integer then return false; end if;
  insert into public.owner_campaign_events(campaign_id,visitor_hash,day,kind,ordinal,nonce) values(p_id,p_visitor,today,'view',frequency+1,p_nonce) on conflict do nothing;
 else
  if not exists(select 1 from public.owner_campaign_events where campaign_id=p_id and visitor_hash=p_visitor and kind='view' and (p_nonce is null or nonce=p_nonce) and created_at>now()-interval '7 days') then return false; end if;
  -- Engagements are lifetime-deduplicated for this browser and campaign.
  if exists(select 1 from public.owner_campaign_events where campaign_id=p_id and visitor_hash=p_visitor and kind=p_kind) then return false; end if;
  insert into public.owner_campaign_events(campaign_id,visitor_hash,day,kind,ordinal,nonce) values(p_id,p_visitor,today,p_kind,1,p_nonce) on conflict do nothing;
 end if;
 get diagnostics admitted=row_count;
 if admitted=0 then return false; end if;
 update public.owner_campaigns set views=views+case when p_kind='view' then 1 else 0 end,
  clicks=clicks+case when p_kind='click' then 1 else 0 end,likes=likes+case when p_kind='like' then 1 else 0 end,
  comments=comments+case when p_kind='comment' then 1 else 0 end,bookings=bookings+case when p_kind='book' then 1 else 0 end,
  spent_cents=case when p_kind='view' then least(total_price_cents,ceil((views+1)*daily_price_cents::numeric/daily_views)::integer) else spent_cents end,updated_at=now() where id=p_id;
 if p_kind='click' and p_viewer is not null then
  insert into public.owner_campaign_attribution(user_id,source_type,source_id,campaign_id,clicked_at)
  values(p_viewer,c.source_type,c.source_id,c.id,now()) on conflict(user_id,source_type,source_id)
  do update set campaign_id=excluded.campaign_id,clicked_at=excluded.clicked_at;
 end if;
 return true;
end $$;

revoke all on function public.owner_campaign_post(text,uuid,uuid),public.owner_campaign_enqueue(),public.owner_campaign_claim_prompt(uuid,uuid),public.owner_campaign_create(uuid,uuid,uuid,text,uuid,text,text,text,text,text,integer,integer),public.owner_campaign_change(uuid,uuid,uuid,text),public.owner_campaign_confirm_payment(uuid,text,integer),public.owner_campaign_review(uuid,boolean),public.owner_campaign_admit(uuid,text,text,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.owner_campaign_post(text,uuid,uuid),public.owner_campaign_claim_prompt(uuid,uuid),public.owner_campaign_create(uuid,uuid,uuid,text,uuid,text,text,text,text,text,integer,integer),public.owner_campaign_change(uuid,uuid,uuid,text),public.owner_campaign_confirm_payment(uuid,text,integer),public.owner_campaign_review(uuid,boolean),public.owner_campaign_admit(uuid,text,text,jsonb,uuid,uuid) to service_role;

-- Pick one post per salon first, then give less-delivered salons priority.
create function public.owner_campaign_candidates(p_area jsonb,p_visitor text,p_viewer uuid default null) returns setof public.owner_campaigns
language sql security definer set search_path=public as $$
 with eligible as (
 select c.*,row_number() over(partition by c.salon_id order by c.views::numeric/(c.days*c.daily_views),c.created_at) salon_rank
 from public.owner_campaigns c
 where c.status='running' and c.starts_at<=now() and c.ends_at>now() and c.payment_reference is not null and c.approved_at is not null
 and c.views<c.days*c.daily_views and c.spent_cents<c.total_price_cents
 and public.owner_campaign_post(c.source_type,c.source_id,c.salon_id) is not null
 and coalesce(public.lifecycle_user_is_salon_owner(c.salon_id,c.owner_id,false),false)
 and (p_viewer is null or not public.lifecycle_user_is_salon_owner(c.salon_id,p_viewer,true))
 and lower(trim(c.country))=lower(trim(p_area->>'country'))
 and (c.area='country' and lower(trim(c.location))=lower(trim(p_area->>'country'))
 or c.area='state' and lower(trim(c.location))=lower(trim(p_area->>'state'))
 or c.area='city' and lower(trim(c.state))=lower(trim(p_area->>'state')) and lower(trim(c.location))=lower(trim(p_area->>'city'))
 or c.area='zipcode' and lower(trim(c.state))=lower(trim(p_area->>'state')) and lower(trim(c.location))=lower(trim(p_area->>'zipcode'))
 or c.area='neighborhood' and lower(trim(c.state))=lower(trim(p_area->>'state')) and lower(trim(c.city))=lower(trim(p_area->>'city')) and lower(trim(c.location))=lower(trim(p_area->>'neighborhood')))
 and (select count(*) from public.owner_campaign_events e where e.campaign_id=c.id and e.day=(now() at time zone 'America/Chicago')::date and e.kind='view') < least(c.daily_views,greatest(1,ceil(extract(epoch from now()-greatest(c.starts_at,date_trunc('day',now() at time zone 'America/Chicago') at time zone 'America/Chicago'))/86400*c.daily_views)::integer))
 and (select count(*) from public.owner_campaign_events e where e.campaign_id=c.id and e.visitor_hash=p_visitor and e.day=(now() at time zone 'America/Chicago')::date and e.kind='view') < (select (config->>'dailyFrequency')::integer from public.owner_campaign_settings where id)
 ) select (select c from public.owner_campaigns c where c.id=e.id) from eligible e where salon_rank=1
 order by e.views::numeric/(e.days*e.daily_views),md5(e.salon_id::text||p_visitor) limit 6;
$$;
revoke all on function public.owner_campaign_candidates(jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.owner_campaign_candidates(jsonb,text,uuid) to service_role;

-- Count completed saves/comments and approved booking requests, only after an authenticated ad click.
create function public.owner_campaign_conversion() returns trigger
language plpgsql security definer set search_path=public as $$
declare item jsonb:=to_jsonb(new); actor uuid; source uuid; source_kind text; event_kind text; cid uuid; accepted integer;
begin
 if tg_table_name in ('salon_profile_look_saves','account_post_saves') then
  event_kind:='like'; actor:=nullif(item->>'user_id','')::uuid;
 elsif tg_table_name='salon_profile_comments' then
  if item->>'status' not in ('visible','published') or coalesce((item->>'is_salon_reply')::boolean,false) then return new; end if;
  event_kind:='comment';actor:=nullif(item->>'author_user_id','')::uuid;
 else
  if tg_table_name='bookings' then
   if item->>'confirmation_status' is distinct from 'confirmed' or item->>'status' not in ('confirmed','checked_in','in_service','completed') then return new; end if;
  elsif item->>'status' is distinct from 'approved' then return new; end if;
  event_kind:='book';actor:=nullif(item->>'customer_user_id','')::uuid;
 end if;
 source:=coalesce(nullif(item->>'source_reference_id',''),nullif(item->>'source_id',''),nullif(item->>'look_id',''),nullif(item->>'update_id',''),nullif(item->>'beauty_post_id',''))::uuid;
 source_kind:=coalesce(item->>'source_reference_type',item->>'source_type',case when item->>'look_id' is not null then 'salon_profile_look' when item->>'update_id' is not null then 'salon_profile_update' when item->>'beauty_post_id' is not null then 'beauty_post' end);
 if actor is null or source is null or source_kind is null then return new; end if;
 select a.campaign_id into cid from public.owner_campaign_attribution a join public.owner_campaigns c on c.id=a.campaign_id
 where a.user_id=actor and a.source_type=source_kind and a.source_id=source and a.clicked_at>now()-interval '7 days'
 and not coalesce(public.lifecycle_user_is_salon_owner(c.salon_id,actor,true),false)
 and (item->>'created_at' is null or (item->>'created_at')::timestamptz>=a.clicked_at);
 if cid is null then return new; end if;
 insert into public.owner_campaign_conversions(campaign_id,user_id,kind,evidence_id)
 values(cid,actor,event_kind,(item->>'id')::uuid) on conflict do nothing;
 get diagnostics accepted=row_count;
 if accepted>0 then update public.owner_campaigns set likes=likes+case when event_kind='like' then 1 else 0 end,
  comments=comments+case when event_kind='comment' then 1 else 0 end,
  bookings=bookings+case when event_kind='book' then 1 else 0 end,updated_at=now() where id=cid; end if;
 return new;
end $$;
revoke all on function public.owner_campaign_conversion() from public,anon,authenticated;
create trigger owner_campaign_conversion after insert on public.salon_profile_look_saves for each row execute function public.owner_campaign_conversion();
create trigger owner_campaign_conversion after insert on public.account_post_saves for each row execute function public.owner_campaign_conversion();
create trigger owner_campaign_conversion after insert or update on public.salon_profile_comments for each row execute function public.owner_campaign_conversion();
create trigger owner_campaign_conversion after insert or update on public.salon_profile_booking_requests for each row execute function public.owner_campaign_conversion();
create trigger owner_campaign_conversion after insert or update on public.bookings for each row execute function public.owner_campaign_conversion();

commit;
