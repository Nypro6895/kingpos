begin;

insert into public.platform_admin_permissions(code,name,description,category)
values ('admin.advertising.review','Review owner ads','Preview, approve or decline owner ads without changing pricing or payment settings.','advertising')
on conflict(code) do nothing;
insert into public.platform_admin_role_permissions(role_id,permission_id)
select r.id,p.id from public.platform_admin_roles r cross join public.platform_admin_permissions p
where r.slug in ('platform_owner','operations_admin','support_agent') and p.code='admin.advertising.review'
on conflict(role_id,permission_id) do nothing;

alter table public.owner_campaign_settings add column version bigint not null default 1;
create table public.campaign_settings_history (
 version bigint primary key, config jsonb not null, actor_user_id uuid references public.users(id),
 created_at timestamptz not null default now()
);
insert into public.campaign_settings_history(version,config) select version,config from public.owner_campaign_settings;
alter table public.owner_campaigns add column settings_version bigint;
alter table public.owner_campaigns add column settings_snapshot jsonb;
alter table public.owner_campaigns add column review_note text;
alter table public.owner_campaigns add column reviewed_at timestamptz;
-- Historical rates already live on each campaign. Backfill only the previously
-- shared delivery caps; never reconstruct or overwrite historical prices.
update public.owner_campaigns set settings_version=s.version,settings_snapshot=s.config
from public.owner_campaign_settings s where s.id;
alter table public.owner_campaigns alter column settings_version set not null;
alter table public.owner_campaigns alter column settings_snapshot set not null;

create function public.campaign_snapshot_settings() returns trigger language plpgsql security definer set search_path=public as $$
begin
 select config,version into new.settings_snapshot,new.settings_version from owner_campaign_settings where id for share;
 return new;
end $$;
create trigger campaign_snapshot_settings before insert on public.owner_campaigns for each row execute function public.campaign_snapshot_settings();

create function public.campaign_version_settings() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.config is distinct from old.config then new.version:=old.version+1; else new.version:=old.version; end if;
 return new;
end $$;
create trigger campaign_version_settings before update on public.owner_campaign_settings for each row execute function public.campaign_version_settings();
create function public.campaign_record_settings() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.version<>old.version then
  insert into campaign_settings_history(version,config,actor_user_id) values(new.version,new.config,public.current_public_user_id());
 end if;
 return new;
end $$;
create trigger campaign_record_settings after update on public.owner_campaign_settings for each row execute function public.campaign_record_settings();

create function public.admin_save_campaign_settings(p_config jsonb,p_expected bigint) returns bigint
language plpgsql security definer set search_path=public as $$
declare actor record; current_version bigint; rule record;
begin
 select * into actor from platform_admin_require_permission('admin.advertising.manage');
 select version into current_version from owner_campaign_settings where id for update;
 if p_expected is null or p_expected<>current_version then raise exception 'This configuration changed. Refresh before saving again.'; end if;
 if p_config is null or jsonb_typeof(p_config)<>'object' or
  (select array_agg(key order by key) from jsonb_object_keys(p_config) key) is distinct from
  (select array_agg(key order by key) from owner_campaign_settings s,jsonb_object_keys(s.config) key where s.id)
 then raise exception 'Invalid campaign settings.'; end if;
 if jsonb_typeof(p_config->'enabled') is distinct from 'boolean' or jsonb_typeof(p_config->'promptsEnabled') is distinct from 'boolean' then raise exception 'Invalid campaign switches.'; end if;
 for rule in select * from (values
 ('dailyPriceCents',100,100000),('viewsPerDollar',1,10000),('maxDays',1,90),('maxCampaigns',1,20),('promptCooldownHours',1,168),
 ('dailyFrequency',1,5),('maxDailyViews',100,100000),('maxAdsPerDay',1,30),('exampleLikesPerThousand',0,1000),
 ('exampleCommentsPerThousand',0,1000),('exampleBookingsPerThousand',0,1000),('welcomeCredits',0,100000),
 ('neighborhoodPricePercent',10,1000),('zipcodePricePercent',10,1000),('cityPricePercent',10,1000),('statePricePercent',10,1000),('countryPricePercent',10,1000)
 ) as limits(key,minimum,maximum) loop
  if jsonb_typeof(p_config->rule.key) is distinct from 'number' or coalesce(p_config->>rule.key,'') !~ '^[0-9]+$' then raise exception 'Invalid campaign setting: %.',rule.key; end if;
  if (p_config->>rule.key)::numeric not between rule.minimum and rule.maximum then raise exception 'Invalid campaign setting: %.',rule.key; end if;
 end loop;
 update owner_campaign_settings set config=p_config,updated_at=now() where id returning version into current_version;
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,reason,metadata)
 values(actor.actor_user_id,'campaign.settings_updated','system','Updated defaults for future campaigns',jsonb_build_object('version',current_version));
 return current_version;
end $$;

-- Keep the settings row locked from quote validation until insert. A stale form
-- cannot silently buy a different delivery rate after an administrator's edit.
create function public.campaign_create_versioned(p_expected bigint,p_id uuid,p_salon uuid,p_user uuid,p_type text,p_source uuid,p_area text,p_location text,p_country text,p_state text,p_city text,p_views integer,p_days integer,p_limit integer,p_keep boolean,p_auto boolean)
returns uuid language plpgsql security definer set search_path=public as $$
declare revision bigint;
begin
 if not coalesce(lifecycle_user_is_salon_owner(p_salon,p_user,false),false) then raise exception 'Owner access required.'; end if;
 select version into revision from owner_campaign_settings where id for share;
 if not exists(select 1 from owner_campaigns where id=p_id) and (p_expected is null or p_expected<>revision) then raise exception 'Campaign options changed. Refresh and review the new credit estimate.'; end if;
 return campaign_create_with_limit(p_id,p_salon,p_user,p_type,p_source,p_area,p_location,p_country,p_state,p_city,p_views,p_days,p_limit,p_keep,p_auto);
end $$;

-- Delivery caps belong to the campaign, not the latest defaults. The emergency
-- delivery switch remains global, as do source safety and owner/installation checks.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.owner_campaign_admit_without_wallet(uuid,text,text,jsonb,uuid,uuid)'::regprocedure);
 if position('select config into cfg from public.owner_campaign_settings where id;' in definition)=0 then raise exception 'Campaign admission source changed; review migration.'; end if;
 definition:=replace(definition,'select config into cfg from public.owner_campaign_settings where id;',
 'cfg:=c.settings_snapshot || jsonb_build_object(''enabled'',(select (config->>''enabled'')::boolean from public.owner_campaign_settings where id));');
 execute definition;
 definition:=pg_get_functiondef('public.owner_campaign_candidates(jsonb,text,uuid)'::regprocedure);
 if position('(select (config->>''dailyFrequency'')::integer from public.owner_campaign_settings where id)' in definition)=0 then raise exception 'Campaign candidate source changed; review migration.'; end if;
 execute replace(definition,'(select (config->>''dailyFrequency'')::integer from public.owner_campaign_settings where id)','(c.settings_snapshot->>''dailyFrequency'')::integer');
end $$;

create table public.campaign_review_notices (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null unique references public.owner_campaigns(id),
 title text not null, created_at timestamptz not null default now(), resolved_at timestamptz
);
create table public.campaign_review_notice_reads (
 notice_id uuid not null references public.campaign_review_notices(id), user_id uuid not null references public.users(id),
 read_at timestamptz not null default now(),primary key(notice_id,user_id)
);
create index campaign_review_notice_recent on public.campaign_review_notices(created_at desc,id);
create index campaign_review_notice_pending on public.campaign_review_notices(created_at desc) where resolved_at is null;
create function public.campaign_notify_review() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='pending_review' then
  insert into campaign_review_notices(campaign_id,title) values(new.id,new.title) on conflict(campaign_id) do nothing;
 else update campaign_review_notices set resolved_at=coalesce(resolved_at,now()) where campaign_id=new.id; end if;
 return new;
end $$;
create trigger campaign_notify_review after insert or update of status on public.owner_campaigns for each row execute function public.campaign_notify_review();
insert into campaign_review_notices(campaign_id,title) select id,title from public.owner_campaigns where status='pending_review';

create function public.admin_campaign_notices(p_read uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor record; result jsonb;
begin
 select * into actor from platform_admin_require_permission('admin.advertising.review');
 if p_read is not null then
  insert into campaign_review_notice_reads(notice_id,user_id) select id,actor.actor_user_id from campaign_review_notices where id=p_read on conflict do nothing;
 end if;
 select jsonb_build_object('unread',(select count(*) from campaign_review_notices n join owner_campaigns c on c.id=n.campaign_id where n.resolved_at is null and c.status='pending_review' and not exists(select 1 from campaign_review_notice_reads r where r.notice_id=n.id and r.user_id=actor.actor_user_id)),
 'items',coalesce((select jsonb_agg(to_jsonb(rows)) from (select n.id,n.campaign_id,n.title,n.created_at,n.resolved_at,r.read_at from campaign_review_notices n left join campaign_review_notice_reads r on r.notice_id=n.id and r.user_id=actor.actor_user_id order by n.created_at desc,n.id limit 20) rows),'[]'::jsonb)) into result;
 return result;
end $$;

create function public.admin_review_campaign(p_id uuid,p_approve boolean,p_reason text) returns void language plpgsql security definer set search_path=public as $$
declare actor record; begin
 select * into actor from platform_admin_require_permission('admin.advertising.review');
 if p_approve is null or length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'A review reason is required (3–1000 characters).'; end if;
 perform owner_campaign_review(p_id,p_approve);
 update owner_campaigns set review_note=btrim(p_reason),reviewed_at=now() where id=p_id;
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,metadata)
 values(actor.actor_user_id,case when p_approve then 'campaign.approved' else 'campaign.declined' end,'system',p_id,btrim(p_reason),jsonb_build_object('campaign_id',p_id));
end $$;

alter table public.campaign_settings_history enable row level security;
alter table public.campaign_review_notices enable row level security;
alter table public.campaign_review_notice_reads enable row level security;
revoke all on public.campaign_settings_history,public.campaign_review_notices,public.campaign_review_notice_reads from anon,authenticated;
grant all on public.campaign_settings_history,public.campaign_review_notices,public.campaign_review_notice_reads to service_role;
revoke all on function public.campaign_snapshot_settings(),public.campaign_version_settings(),public.campaign_record_settings(),public.campaign_notify_review(),public.admin_campaign_notices(uuid),public.admin_review_campaign(uuid,boolean,text),public.admin_save_campaign_settings(jsonb,bigint),public.campaign_create_versioned(bigint,uuid,uuid,uuid,text,uuid,text,text,text,text,text,integer,integer,integer,boolean,boolean) from public,anon,authenticated;
grant execute on function public.admin_campaign_notices(uuid),public.admin_review_campaign(uuid,boolean,text),public.admin_save_campaign_settings(jsonb,bigint) to authenticated;
grant execute on function public.campaign_create_versioned(bigint,uuid,uuid,uuid,text,uuid,text,text,text,text,text,integer,integer,integer,boolean,boolean) to service_role;
create function public.admin_stop_campaign_purchases(p_salon uuid,p_reason text) returns void language plpgsql security definer set search_path=public as $$
declare actor record; begin
 select * into actor from platform_admin_require_permission('admin.team.manage');
 if actor.actor_role_slug<>'platform_owner' then raise exception 'Platform owner access required.'; end if;
 if length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'A reason is required.'; end if;
 perform 1 from campaign_wallets where salon_id=p_salon for update;
 if not found then raise exception 'Credit wallet not found.'; end if;
 update campaign_wallets set auto_topup_enabled=false,auto_topup_consent_at=null,payment_revision=payment_revision+1,updated_at=now() where salon_id=p_salon;
 update campaign_credit_orders set status='cancelled' where salon_id=p_salon and automatic and status='pending';
 update owner_campaigns set auto_fund=false where salon_id=p_salon;
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,metadata)
 values(actor.actor_user_id,'campaign.auto_purchases_stopped','system',p_salon,btrim(p_reason),jsonb_build_object('salon_id',p_salon));
end $$;
revoke all on function public.admin_stop_campaign_purchases(uuid,text) from public,anon,authenticated;
grant execute on function public.admin_stop_campaign_purchases(uuid,text) to authenticated;
commit;
