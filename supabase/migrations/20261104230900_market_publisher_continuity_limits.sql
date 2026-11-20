begin;
create index market_submission_window on market_platform.events(actor_id,created_at) where kind='submitted';
-- Review and public profile changes share the organization lock. Approval may
-- not silently acquire a different publisher name during a concurrent rename.
alter function public.market_platform_review(uuid,text,text,text) set schema market_platform;
alter function market_platform.market_platform_review(uuid,text,text,text) rename to review_base;
revoke all on function market_platform.review_base(uuid,text,text,text) from public,anon,authenticated,service_role;
create function public.market_platform_review(p_version uuid,p_sha256 text,p_decision text,p_reason text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
begin
 perform 1 from organizations o join apps a on a.organization_id=o.id join versions v on v.app_id=a.id where v.id=p_version for update of o;
 return review_base(p_version,p_sha256,p_decision,p_reason);
end $$;
alter function public.market_platform_profile_save(text,text,text,text) set schema market_platform;
alter function market_platform.market_platform_profile_save(text,text,text,text) rename to profile_save_base;
revoke all on function market_platform.profile_save_base(text,text,text,text) from public,anon,authenticated,service_role;
create function public.market_platform_profile_save(p_name text,p_email text,p_website text,p_description text) returns boolean language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor();o organizations;
begin
 select * into o from organizations where owner_id=actor for update;
 if o.id is not null and btrim(p_name) is distinct from o.name and exists(select 1 from apps a join versions v on v.app_id=a.id join reviews r on r.version_id=v.id and r.decision='approved' where a.organization_id=o.id)
 then raise exception using errcode='22023',message='The publisher name is locked after an approved version. Keep the reviewed name when updating contact details.';end if;
 return profile_save_base(p_name,p_email,p_website,p_description);
end $$;

alter function public.market_platform_submit(uuid,jsonb,uuid) set schema market_platform;
alter function market_platform.market_platform_submit(uuid,jsonb,uuid) rename to submit_base;
revoke all on function market_platform.submit_base(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
create function public.market_platform_submit(p_app uuid,p_manifest jsonb,p_request uuid default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor();org uuid;aid uuid;
begin
 select id into org from organizations where owner_id=actor for update;
 if p_app is null then select id into aid from apps where organization_id=org and request_id=p_request;
 else select id into aid from apps where id=p_app and organization_id=org;end if;
 -- Exact immutable retries still work even after reaching the hourly limit.
 if aid is not null and exists(select 1 from versions where app_id=aid and version=p_manifest->>'version') then return submit_base(p_app,p_manifest,p_request);end if;
 if org is not null and (select count(*) from events where actor_id=actor and kind='submitted' and created_at>now()-interval '1 hour')>=30
 then raise exception using errcode='22023',message='Submission limit reached: 30 new versions per rolling hour. Existing submissions are safe. Retry later.';end if;
 return submit_base(p_app,p_manifest,p_request);
end $$;

create function public.market_platform_developer_limits() returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor();org uuid;
begin
 select id into org from organizations where owner_id=actor;
 if org is null then raise exception using errcode='42501',message='Developer organization owner required.';end if;
 return jsonb_build_object('publisherNameLocked',exists(select 1 from apps a join versions v on v.app_id=a.id join reviews r on r.version_id=v.id and r.decision='approved' where a.organization_id=org),
 'appsUsed',(select count(*) from apps where organization_id=org),'appsLimit',50,'versionsPerAppLimit',100,'hourlySubmissionsUsed',(select count(*) from events where actor_id=actor and kind='submitted' and created_at>now()-interval '1 hour'),'hourlySubmissionsLimit',30);
end $$;
revoke all on function public.market_platform_review(uuid,text,text,text),public.market_platform_profile_save(text,text,text,text),public.market_platform_submit(uuid,jsonb,uuid),public.market_platform_developer_limits() from public,anon,authenticated,service_role;
grant execute on function public.market_platform_review(uuid,text,text,text),public.market_platform_profile_save(text,text,text,text),public.market_platform_submit(uuid,jsonb,uuid),public.market_platform_developer_limits() to authenticated;
commit;
