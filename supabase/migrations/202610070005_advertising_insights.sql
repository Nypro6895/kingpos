begin;
create table if not exists public.advertising_settings (
 id boolean primary key default true check(id), config jsonb not null default '{"maxTotal":6,"maxPopups":1,"minPopupGapSeconds":60,"sessionMinutes":30}'::jsonb
);
insert into public.advertising_settings(id) values(true) on conflict do nothing;
create table if not exists public.advertising_events (
 id bigint generated always as identity primary key,
 campaign_id uuid not null, campaign_name text not null, campaign_kind text not null,
 session_id uuid not null, kind text not null check(kind in ('view','click','signup')),
 device text not null check(device in ('desktop','mobile')), audience text not null check(audience in ('guest','personal','staff','owner')),
 path text not null, auth_user_id uuid, created_at timestamptz not null default now()
);
alter table public.advertising_events drop constraint if exists advertising_events_campaign_id_session_id_kind_key;
create unique index if not exists advertising_session_event_once on public.advertising_events(campaign_id,session_id,kind) where kind in ('view','click');
create unique index if not exists advertising_signup_user_once on public.advertising_events(auth_user_id) where kind='signup';
create index if not exists advertising_event_session on public.advertising_events(session_id,created_at);
create index if not exists advertising_event_date on public.advertising_events(created_at,campaign_id);
alter table public.advertising_settings enable row level security;
alter table public.advertising_events enable row level security;
revoke all on public.advertising_settings,public.advertising_events from public,anon,authenticated;
grant all on public.advertising_settings,public.advertising_events to service_role;
grant usage,select on sequence public.advertising_events_id_seq to service_role;
create or replace function public.record_advertising_event(p_campaign uuid,p_session uuid,p_kind text,p_device text,p_audience text,p_path text,p_visitor text default null,p_user uuid default null) returns boolean
language plpgsql security definer set search_path=public as $$
declare campaign jsonb; settings jsonb; total integer; popups integer; previous_popup timestamptz;
begin
 if p_kind not in ('view','click','signup') or p_device not in ('desktop','mobile') or p_audience not in ('guest','personal','staff','owner') or length(p_path)>512 then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_session::text,0));
 select config into campaign from explore_campaigns where id=p_campaign;
 if campaign is null and p_kind='signup' then select jsonb_build_object('name',campaign_name,'kind',campaign_kind) into campaign from advertising_events where campaign_id=p_campaign and session_id=p_session and kind='click' limit 1; end if;
 if campaign is null then return false; end if;
 if p_kind='view' then
   if not coalesce((campaign->>'enabled')::boolean,false) or (campaign->>'startsAt')::timestamptz>now() or (campaign->>'endsAt')::timestamptz<=now() then return false; end if;
   if exists(select 1 from advertising_events where session_id=p_session and campaign_id=p_campaign and kind='view') then return false; end if;
   select config into settings from advertising_settings where id=true;
   select count(*) into total from advertising_events where session_id=p_session and kind='view';
   if total >= coalesce((settings->>'maxTotal')::integer,6) then return false; end if;
   if campaign->>'kind'='popup' then
     select count(*),max(e.created_at) into popups,previous_popup from advertising_events e where e.session_id=p_session and e.kind='view' and e.campaign_kind='popup';
     if popups>=coalesce((settings->>'maxPopups')::integer,1) or previous_popup>now()-make_interval(secs=>coalesce((settings->>'minPopupGapSeconds')::integer,60)) then return false; end if;
     if p_visitor is null or not claim_explore_popup(p_campaign,p_visitor) then return false; end if;
   end if;
 elsif p_kind='click' then
   if not exists(select 1 from advertising_events where session_id=p_session and campaign_id=p_campaign and kind='view') then return false; end if;
   select device,audience,path into p_device,p_audience,p_path from advertising_events where session_id=p_session and campaign_id=p_campaign and kind='view';
 elsif p_kind='signup' then
   if p_user is null or not exists(select 1 from advertising_events where session_id=p_session and campaign_id=p_campaign and kind='click' and created_at>now()-interval '7 days') then return false; end if;
   select device,audience,path into p_device,p_audience,p_path from advertising_events where session_id=p_session and campaign_id=p_campaign and kind='click';
 end if;
 insert into advertising_events(campaign_id,campaign_name,campaign_kind,session_id,kind,device,audience,path,auth_user_id) values(p_campaign,campaign->>'name',campaign->>'kind',p_session,p_kind,p_device,p_audience,p_path,case when p_kind='signup' then p_user else null end) on conflict do nothing;
 return true;
end $$;
create or replace function public.advertising_report(p_days integer default 90) returns table(campaign_id uuid,day date,device text,audience text,views bigint,clicks bigint,signups bigint,campaign_name text)
language sql security definer set search_path=public as $$
 select e.campaign_id,(v.created_at at time zone 'America/Chicago')::date,e.device,e.audience,count(*) filter(where e.kind='view'),count(*) filter(where e.kind='click'),count(*) filter(where e.kind='signup'),max(e.campaign_name) from advertising_events e join advertising_events v on v.session_id=e.session_id and v.campaign_id=e.campaign_id and v.kind='view' where v.created_at>=(date_trunc('day',now() at time zone 'America/Chicago') at time zone 'America/Chicago')-make_interval(days=>least(365,greatest(1,p_days))-1) group by 1,2,3,4 order by 2 desc;
$$;
revoke all on function public.record_advertising_event(uuid,uuid,text,text,text,text,text,uuid),public.advertising_report(integer) from public,anon,authenticated;
grant execute on function public.record_advertising_event(uuid,uuid,text,text,text,text,text,uuid),public.advertising_report(integer) to service_role;
commit;
