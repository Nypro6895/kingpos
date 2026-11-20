begin;
-- Reserving an eligible display does not count a view or consume frequency history.
create table public.advertising_display_reservations (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.explore_campaigns(id) on delete cascade,
 session_id uuid not null, visitor_hash text not null,
 campaign_kind text not null, device text not null, audience text not null, path text not null,
 expires_at timestamptz not null default now() + interval '30 seconds',
 confirmed_at timestamptz,
 unique(campaign_id,session_id)
);
create index advertising_reservation_session on public.advertising_display_reservations(session_id,expires_at);
create index advertising_reservation_visitor on public.advertising_display_reservations(campaign_id,visitor_hash,expires_at);
create index advertising_reservation_expiry on public.advertising_display_reservations(expires_at);
alter table public.advertising_display_reservations enable row level security;
revoke all on public.advertising_display_reservations from public,anon,authenticated;
grant all on public.advertising_display_reservations to service_role;

create function public.reserve_advertising_display(p_campaign uuid,p_session uuid,p_visitor text,p_device text,p_audience text,p_path text) returns uuid
language plpgsql security definer set search_path=public as $$
declare c jsonb; settings jsonb; seen timestamptz; token uuid; total integer; popups integer; last_popup timestamptz;
begin
 if p_visitor is null or p_device not in ('desktop','mobile') or p_audience not in ('guest','personal','staff','owner') or length(p_path)>512 then return null; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_session::text,0));
 -- Opportunistic, bounded retention for this new transient table only. Reports are untouched.
 delete from advertising_display_reservations where id in (
   select id from advertising_display_reservations where expires_at<now()-interval '7 days'
   order by expires_at limit 100 for update skip locked
 );
 select config into c from explore_campaigns where id=p_campaign;
 if c is null or not coalesce((c->>'enabled')::boolean,false) or (c->>'startsAt')::timestamptz>now() or (c->>'endsAt')::timestamptz<=now() then return null; end if;
 if exists(select 1 from advertising_events where session_id=p_session and campaign_id=p_campaign and kind='view') then return null; end if;
 select id into token from advertising_display_reservations where session_id=p_session and campaign_id=p_campaign and visitor_hash=p_visitor and confirmed_at is null and expires_at>now();
 if token is not null then return token; end if;
 -- Session-scoped cleanup is bounded by the number of campaigns encountered in that session.
 delete from advertising_display_reservations where session_id=p_session and expires_at<=now() and confirmed_at is null;
 select config into settings from advertising_settings where id=true;
 select count(*) into total from advertising_events where session_id=p_session and kind='view';
 total:=total+(select count(*) from advertising_display_reservations where session_id=p_session and confirmed_at is null and expires_at>now());
 if total>=coalesce((settings->>'maxTotal')::integer,6) then return null; end if;
 if c->>'kind'='popup' then
   perform pg_advisory_xact_lock(hashtextextended(p_campaign::text||p_visitor,0));
   select count(*),max(created_at) into popups,last_popup from advertising_events where session_id=p_session and kind='view' and campaign_kind='popup';
   popups:=popups+(select count(*) from advertising_display_reservations where session_id=p_session and campaign_kind='popup' and confirmed_at is null and expires_at>now());
   if popups>=coalesce((settings->>'maxPopups')::integer,1) or last_popup>now()-make_interval(secs=>coalesce((settings->>'minPopupGapSeconds')::integer,60)) then return null; end if;
   select last_seen into seen from explore_campaign_impressions where campaign_id=p_campaign and visitor_hash=p_visitor;
   if seen is not null and (c->>'repeat'='once' or (c->>'repeat'='daily' and (seen at time zone 'America/Chicago')::date=(now() at time zone 'America/Chicago')::date)) then return null; end if;
   if exists(select 1 from advertising_display_reservations where campaign_id=p_campaign and visitor_hash=p_visitor and confirmed_at is null and expires_at>now()) then return null; end if;
 end if;
 insert into advertising_display_reservations(campaign_id,session_id,visitor_hash,campaign_kind,device,audience,path)
 values(p_campaign,p_session,p_visitor,c->>'kind',p_device,p_audience,p_path) returning id into token;
 return token;
end $$;

create function public.confirm_advertising_display(p_token uuid,p_session uuid,p_visitor text,p_campaign uuid) returns boolean
language plpgsql security definer set search_path=public as $$
declare r advertising_display_reservations; accepted boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_session::text,0));
 select * into r from advertising_display_reservations where id=p_token and session_id=p_session and visitor_hash=p_visitor and campaign_id=p_campaign for update;
 if r.id is null then return false; end if;
 if r.confirmed_at is not null then return true; end if;
 if r.expires_at<=now() then return false; end if;
 accepted:=record_advertising_event(r.campaign_id,r.session_id,'view',r.device,r.audience,r.path,r.visitor_hash);
 if accepted then update advertising_display_reservations set confirmed_at=now() where id=r.id;
 else delete from advertising_display_reservations where id=r.id; end if;
 return accepted;
end $$;
revoke all on function public.reserve_advertising_display(uuid,uuid,text,text,text,text),public.confirm_advertising_display(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.reserve_advertising_display(uuid,uuid,text,text,text,text),public.confirm_advertising_display(uuid,uuid,text,uuid) to service_role;
commit;
