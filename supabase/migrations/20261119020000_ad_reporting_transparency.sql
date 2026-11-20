begin;

-- Reports refer to a verified delivery, not a caller-chosen social-content ID.
-- Private evidence never contains a delivery ticket, visitor hash, GPS or query.
create table public.ad_report_evidence (
 report_id uuid primary key references public.platform_reports(id) on delete cascade,
 request_id uuid not null,
 actor_key text,
 actor_user_id uuid references public.users(id) on delete set null,
 source_author_user_id uuid references public.users(id) on delete set null,
 source_creator_user_id uuid references public.users(id) on delete set null,
 campaign_owner_user_id uuid references public.users(id) on delete set null,
 payload_sha256 text not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
 target jsonb not null,
 snapshot jsonb not null,
 selection_summary jsonb not null,
 reason text not null check(reason in ('scam','sexual','violence','age_inappropriate','intellectual_property','other')),
 details text not null check(length(details)<=1000),
 created_at timestamptz not null default now(),
 unique(actor_key,request_id)
);
alter table public.ad_report_evidence enable row level security;
revoke all on public.ad_report_evidence from public,anon,authenticated,service_role;
create index ad_report_evidence_actor_time on public.ad_report_evidence(actor_key,created_at desc);
create index ad_report_evidence_source_author on public.ad_report_evidence(source_author_user_id);
create index ad_report_evidence_actor_identity on public.ad_report_evidence(actor_user_id);
create index ad_report_evidence_source_creator on public.ad_report_evidence(source_creator_user_id);
create index ad_report_evidence_campaign_owner on public.ad_report_evidence(campaign_owner_user_id);

create function public.ad_report_actor_key(p_user uuid,p_guest text) returns text
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if num_nonnulls(p_user,p_guest)<>1 then raise exception 'Invalid report actor.' using errcode='22023';end if;
 if p_user is not null then
  if not exists(select 1 from public.users where id=p_user and status='active') then raise exception 'Report actor unavailable.' using errcode='42501';end if;
  return 'u:'||p_user::text;
 end if;
 if p_guest !~ '^[a-f0-9]{64}$' then raise exception 'Invalid report actor.' using errcode='22023';end if;
 return 'g:'||p_guest;
end;$$;
revoke all on function public.ad_report_actor_key(uuid,text) from public,anon,authenticated,service_role;

create function public.get_verified_ad_report_receipt(p_request_id uuid,p_actor_user_id uuid,p_guest_actor_key text,p_payload_sha256 text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare k text:=public.ad_report_actor_key(p_actor_user_id,p_guest_actor_key); e public.ad_report_evidence; ref text;
begin
 if p_request_id is null or p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'Invalid report request.' using errcode='22023';end if;
 select * into e from public.ad_report_evidence where actor_key=k and request_id=p_request_id;
 if not found then return null;end if;
 if e.payload_sha256<>p_payload_sha256 then raise exception 'Report request conflicts with its original contents.' using errcode='22023';end if;
 select report_number into ref from public.platform_reports where id=e.report_id;
 return jsonb_build_object('reportId',e.report_id,'reference',ref,'guestThreadId',null);
end;$$;
revoke all on function public.get_verified_ad_report_receipt(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.get_verified_ad_report_receipt(uuid,uuid,text,text) to service_role;

create function public.submit_verified_ad_report(p_request_id uuid,p_actor_user_id uuid,p_guest_actor_key text,p_target jsonb,p_snapshot jsonb,p_summary jsonb,p_reason text,p_details text,p_payload_sha256 text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare k text:=public.ad_report_actor_key(p_actor_user_id,p_guest_actor_key);e public.ad_report_evidence;cid uuid;sid uuid;salon uuid;author_id uuid;creator_id uuid;owner_id uuid;identity_id uuid;campaign public.owner_campaigns;platform public.explore_campaigns;rid uuid;ref text;key text;v jsonb;stamp timestamptz;
begin
 if p_request_id is null or p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'Invalid report request.' using errcode='22023';end if;
 -- Account erasure changes status before clearing private evidence. Hold the
 -- active identity through admission so a stale request cannot recreate it.
 if p_actor_user_id is not null then
  perform 1 from public.users where id=p_actor_user_id and status='active' for share nowait;
  if not found then raise exception 'Report actor unavailable.' using errcode='42501';end if;
 end if;
 -- Serialize an actor's quota and concurrent unknown-outcome retries together.
 perform pg_advisory_xact_lock(hashtextextended('ad-report:'||k,0));
 select * into e from public.ad_report_evidence where actor_key=k and request_id=p_request_id;
 if found then
  if e.payload_sha256<>p_payload_sha256 or e.target is distinct from p_target or e.snapshot is distinct from p_snapshot or e.selection_summary is distinct from p_summary or e.reason is distinct from p_reason or e.details is distinct from p_details then raise exception 'Report request conflicts with its original contents.' using errcode='22023';end if;
  return public.get_verified_ad_report_receipt(p_request_id,p_actor_user_id,p_guest_actor_key,p_payload_sha256);
 end if;
 if p_target is null or jsonb_typeof(p_target)<>'object' or not(p_target ?& array['kind','campaignId','sourceType','sourceId','salonId']) or exists(select 1 from jsonb_object_keys(p_target)t where t not in('kind','campaignId','sourceType','sourceId','salonId')) then raise exception 'Invalid advertising target.' using errcode='22023';end if;
 foreach key in array array['kind','campaignId','sourceType','sourceId'] loop
  if jsonb_typeof(p_target->key) is distinct from 'string' then raise exception 'Invalid advertising target.' using errcode='22023';end if;
 end loop;
 if jsonb_typeof(p_target->'salonId') not in('string','null') or p_target->>'kind' not in('owner_campaign','platform_campaign') or p_target->>'campaignId' !~ '^[a-fA-F0-9-]{36}$' or p_target->>'sourceId' !~ '^[a-fA-F0-9-]{36}$' then raise exception 'Invalid advertising target.' using errcode='22023';end if;
 cid:=(p_target->>'campaignId')::uuid;sid:=(p_target->>'sourceId')::uuid;salon:=(p_target->>'salonId')::uuid;
 if cid is null or sid is null then raise exception 'Invalid advertising target.' using errcode='22023';end if;
 if p_target->>'kind'='owner_campaign' then
  select * into campaign from public.owner_campaigns where id=cid for key share;
  if not found or campaign.source_type is distinct from p_target->>'sourceType' or campaign.source_id<>sid or campaign.salon_id is distinct from salon then raise exception 'Advertising target unavailable.' using errcode='22023';end if;
  author_id:=campaign.owner_id;owner_id:=campaign.owner_id;
  if campaign.source_type='custom' and not exists(select 1 from public.owner_campaign_creatives where id=sid and salon_id=salon) then raise exception 'Advertising source unavailable.' using errcode='22023';end if;
  if campaign.source_type='beauty_post' and not exists(select 1 from public.beauty_posts where id=sid) then raise exception 'Advertising source unavailable.' using errcode='22023';end if;
  if campaign.source_type='salon_profile_look' and not exists(select 1 from public.salon_profile_looks where id=sid and salon_id=salon) then raise exception 'Advertising source unavailable.' using errcode='22023';end if;
  if campaign.source_type='salon_profile_update' and not exists(select 1 from public.salon_profile_updates where id=sid and salon_id=salon) then raise exception 'Advertising source unavailable.' using errcode='22023';end if;
  if campaign.source_type='beauty_post' then select author_user_id into author_id from public.beauty_posts where id=sid;
  elsif campaign.source_type='custom' then select author_user_id into author_id from public.owner_campaign_creatives where id=sid;
  elsif campaign.source_type='salon_profile_look' then select coalesce(author_user_id,created_by_user_id),created_by_user_id into author_id,creator_id from public.salon_profile_looks where id=sid;
  elsif campaign.source_type='salon_profile_update' then select coalesce(author_user_id,created_by_user_id),created_by_user_id into author_id,creator_id from public.salon_profile_updates where id=sid;end if;
  for identity_id in select distinct x from unnest(array[author_id,creator_id,owner_id]) x where x is not null order by x loop
   perform 1 from public.users where id=identity_id and status='active' for share nowait;
   if not found then raise exception 'Advertising source unavailable.' using errcode='22023';end if;
  end loop;
 else
  select * into platform from public.explore_campaigns where id=cid for key share;
  if not found or p_target->>'sourceType'<>'explore_campaign' or sid<>cid or salon is not null or platform.config->>'id' is distinct from cid::text then raise exception 'Advertising target unavailable.' using errcode='22023';end if;
 end if;
 if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' or octet_length(p_snapshot::text)>16000 or not(p_snapshot ?& array['advertiserName','title','caption','mediaBucket','mediaPath','destinationPath','selectedAt']) or exists(select 1 from jsonb_object_keys(p_snapshot)t where t not in('advertiserName','title','caption','mediaBucket','mediaPath','destinationPath','selectedAt')) then raise exception 'Invalid advertising evidence.' using errcode='22023';end if;
 foreach key in array array['advertiserName','title','caption','selectedAt'] loop
  if jsonb_typeof(p_snapshot->key)<>'string' then raise exception 'Invalid advertising evidence.' using errcode='22023';end if;
 end loop;
 if length(p_snapshot->>'advertiserName') not between 1 and 200 or length(p_snapshot->>'title')>200 or length(p_snapshot->>'caption')>5000 then raise exception 'Invalid advertising evidence.' using errcode='22023';end if;
 foreach key in array array['mediaBucket','mediaPath','destinationPath'] loop
  if jsonb_typeof(p_snapshot->key) not in('string','null') or length(p_snapshot->>key)>1000 then raise exception 'Invalid advertising evidence.' using errcode='22023';end if;
 end loop;
 if num_nonnulls(p_snapshot->>'mediaBucket',p_snapshot->>'mediaPath') not in(0,2) or (p_snapshot->>'mediaBucket' is not null and p_snapshot->>'mediaBucket' not in('campaign-creatives','beauty-profile-media','salon-profile-media')) or (p_snapshot->>'mediaPath' is not null and (p_snapshot->>'mediaPath' ~ '(^/|\.\.|[?#\\])' or length(p_snapshot->>'mediaPath')<1)) or (p_snapshot->>'destinationPath' is not null and (p_snapshot->>'destinationPath' !~ '^/[^/]' or p_snapshot->>'destinationPath' ~ '[?#\\]')) then raise exception 'Invalid advertising evidence path.' using errcode='22023';end if;
 -- The server verifies the authenticated delivery proof. SQL also limits its
 -- persisted summary, independently refusing arbitrary JSON/private inputs.
 if p_summary is null or jsonb_typeof(p_summary)<>'object' or octet_length(p_summary::text)>3000 or not(p_summary ?& array['locationSource','areaLabel','searchKind','searchCategory','page','device','audience','selectionRuleCodes','selectedAt']) or exists(select 1 from jsonb_object_keys(p_summary)t where t not in('locationSource','areaLabel','searchKind','searchCategory','page','device','audience','selectionRuleCodes','selectedAt')) then raise exception 'Invalid advertising selection summary.' using errcode='22023';end if;
 if jsonb_typeof(p_summary->'locationSource')<>'string' or p_summary->>'locationSource' not in('gps','manual','search','none') or jsonb_typeof(p_summary->'page')<>'string' or length(p_summary->>'page') not between 1 and 100 or p_summary->>'page' !~ '^[a-zA-Z0-9_/-]+$' or jsonb_typeof(p_summary->'selectedAt')<>'string' then raise exception 'Invalid advertising selection summary.' using errcode='22023';end if;
 foreach key in array array['areaLabel','searchKind','searchCategory','device','audience'] loop
  if jsonb_typeof(p_summary->key) not in('string','null') or length(p_summary->>key)>200 then raise exception 'Invalid advertising selection summary.' using errcode='22023';end if;
 end loop;
 if p_summary->>'device' is not null and p_summary->>'device' not in('mobile','desktop') then raise exception 'Invalid advertising selection summary.' using errcode='22023';end if;
 if jsonb_typeof(p_summary->'selectionRuleCodes')<>'array' then raise exception 'Invalid advertising selection summary.' using errcode='22023';end if;
 if jsonb_array_length(p_summary->'selectionRuleCodes')>24 then raise exception 'Invalid advertising selection summary.' using errcode='22023';end if;
 for v in select value from jsonb_array_elements(p_summary->'selectionRuleCodes') loop
  if jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^[a-z][a-z0-9_]{0,63}$' then raise exception 'Invalid advertising selection summary.' using errcode='22023';end if;
 end loop;
 stamp:=(p_snapshot->>'selectedAt')::timestamptz;
 if stamp is null or not isfinite(stamp) or stamp>now()+interval '5 minutes' or stamp is distinct from (p_summary->>'selectedAt')::timestamptz then raise exception 'Invalid advertising selection time.' using errcode='22023';end if;
 if p_reason is null or p_reason not in('scam','sexual','violence','age_inappropriate','intellectual_property','other') or p_details is null or length(p_details)>1000 then raise exception 'Invalid report contents.' using errcode='22023';end if;
 if (select count(*) from public.ad_report_evidence where actor_key=k and created_at>now()-interval '1 hour')>=5 then raise exception 'Too many reports. Please try again later.' using errcode='P0001';end if;
 insert into public.platform_reports(category,summary,description,source,reporter_user_id,created_by_user_id,support_request_id,support_context)
 values('advertising','Advertising report: '||replace(p_reason,'_',' '),case when p_details='' then 'Please review the reported advertising placement.' else p_details end,case when p_actor_user_id is null then 'advertising_report' else 'user_support' end,p_actor_user_id,p_actor_user_id,p_request_id,jsonb_build_object('module','advertising_report')) returning id,report_number into rid,ref;
 if p_actor_user_id is not null then insert into public.support_case_messages(report_id,actor_user_id,sender,body) values(rid,p_actor_user_id,'user',case when p_details='' then 'Please review the reported advertising placement.' else p_details end);end if;
 insert into public.ad_report_evidence(report_id,request_id,actor_key,actor_user_id,source_author_user_id,source_creator_user_id,campaign_owner_user_id,payload_sha256,target,snapshot,selection_summary,reason,details)
 values(rid,p_request_id,k,p_actor_user_id,author_id,creator_id,owner_id,p_payload_sha256,p_target,p_snapshot,p_summary,p_reason,p_details);
 return jsonb_build_object('reportId',rid,'reference',ref,'guestThreadId',null);
end;$$;
revoke all on function public.submit_verified_ad_report(uuid,uuid,text,jsonb,jsonb,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_verified_ad_report(uuid,uuid,text,jsonb,jsonb,jsonb,text,text,text) to service_role;

create function public.get_admin_ad_report_evidence(p_report_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare e public.ad_report_evidence; href text;
begin
 perform public.platform_admin_require_permission('admin.reports.read');
 perform public.get_platform_admin_report_detail(p_report_id);
 select * into e from public.ad_report_evidence where report_id=p_report_id;
 if not found then return null;end if;
 href:=case e.target->>'kind' when 'owner_campaign' then '/admin/plugins/campaigns' else '/admin/advertising' end;
 return jsonb_build_object('target',e.target,'snapshot',e.snapshot,'summary',e.selection_summary,'reason',e.reason,'details',e.details,'reviewHref',href);
end;$$;
revoke all on function public.get_admin_ad_report_evidence(uuid) from public,anon;
grant execute on function public.get_admin_ad_report_evidence(uuid) to authenticated;

-- Ordinary ad evidence has no special retention exception to account erasure.
-- Generic Support case erasure remains governed by its existing workflow.
create function public.erase_ad_report_evidence_identity() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='DELETE' or (new.status='deleted' and old.status is distinct from new.status) then
  delete from public.ad_report_evidence where actor_user_id=old.id or source_author_user_id=old.id or source_creator_user_id=old.id or campaign_owner_user_id=old.id;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end;$$;
revoke all on function public.erase_ad_report_evidence_identity() from public,anon,authenticated,service_role;
create trigger ad_report_identity_erasure after update of status on public.users for each row execute function public.erase_ad_report_evidence_identity();
create trigger ad_report_identity_physical_erasure before delete on public.users for each row execute function public.erase_ad_report_evidence_identity();

comment on table public.ad_report_evidence is 'Service-verified advertising deliveries. No automatic hiding, campaign pause, billing event, tracking ID, precise location or ordinary Support attachment.';

-- Existing ordinary cleanup and new case-specific removal share this reference
-- fence. A report cannot reattach a key after either remover fenced it.
alter function public.public_post_media_has_reference(text,text) rename to public_post_media_has_reference_before_ad_reports;
revoke all on function public.public_post_media_has_reference_before_ad_reports(text,text) from public,anon,authenticated,service_role;
create function public.public_post_media_has_reference(b text,p text) returns boolean
language plpgsql volatile security definer set search_path=pg_catalog,public as $$
begin
 return exists(select 1 from public.ad_report_evidence where snapshot->>'mediaBucket'=b and snapshot->>'mediaPath'=p)
 or public.public_post_media_has_reference_before_ad_reports(b,p);
end;$$;
revoke all on function public.public_post_media_has_reference(text,text) from public,anon,authenticated,service_role;
create function public.guard_ad_report_media_reference() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.snapshot->>'mediaBucket' in('beauty-profile-media','salon-profile-media') then
  perform public.lock_public_post_media_reference(new.snapshot->>'mediaBucket',new.snapshot->>'mediaPath');
 end if;return new;
end;$$;
revoke all on function public.guard_ad_report_media_reference() from public,anon,authenticated,service_role;
create trigger aa_ad_report_media_reference before insert or update of snapshot on public.ad_report_evidence for each row execute function public.guard_ad_report_media_reference();
commit;
