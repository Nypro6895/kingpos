begin;
create table if not exists public.explore_campaigns (
 id uuid primary key, config jsonb not null check(jsonb_typeof(config)='object'),
 updated_at timestamptz not null default now(), updated_by uuid references public.users(id)
);
create table if not exists public.explore_campaign_impressions (
 campaign_id uuid not null references public.explore_campaigns(id) on delete cascade,
 visitor_hash text not null, last_seen timestamptz not null default now(), primary key(campaign_id,visitor_hash)
);
alter table public.explore_campaigns enable row level security;
alter table public.explore_campaign_impressions enable row level security;
revoke all on public.explore_campaigns,public.explore_campaign_impressions from public,anon,authenticated;
grant all on public.explore_campaigns,public.explore_campaign_impressions to service_role;
create or replace function public.claim_explore_popup(p_campaign uuid,p_visitor text) returns boolean
language plpgsql security definer set search_path=public as $$
declare campaign jsonb; seen timestamptz;
begin
 select config into campaign from explore_campaigns where id=p_campaign;
 if campaign is null or campaign->>'kind'<>'popup' or not (campaign->>'enabled')::boolean then return false; end if;
 if (campaign->>'startsAt')::timestamptz>now() or (campaign->>'endsAt')::timestamptz<=now() then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_campaign::text||p_visitor,0));
 select last_seen into seen from explore_campaign_impressions where campaign_id=p_campaign and visitor_hash=p_visitor;
 if seen is not null and (campaign->>'repeat'='once' or (campaign->>'repeat'='daily' and (seen at time zone 'America/Chicago')::date=(now() at time zone 'America/Chicago')::date)) then return false; end if;
 insert into explore_campaign_impressions(campaign_id,visitor_hash) values(p_campaign,p_visitor) on conflict(campaign_id,visitor_hash) do update set last_seen=now();
 return true;
end $$;
revoke all on function public.claim_explore_popup(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_explore_popup(uuid,text) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('explore-advertising','explore-advertising',true,10485760,array['image/jpeg','image/png','image/webp','image/gif']) on conflict(id) do nothing;
commit;
