-- Source-only implementation. No operator assignment or enabled policy is seeded.
-- Ordinary evidence: owner-approved 30 days AFTER explicit case closure, not
-- resolution/capture. No automatic legal hold or public restoration is created.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table if not exists public.rights_image_evidence_policy(
 id boolean primary key default true check(id), version text not null,
 enabled boolean not null default false, owner_decision_ref text not null,
 closed_retention_days integer not null check(closed_retention_days=30),
 erasure_default text not null check(erasure_default='erase_with_account')
);
insert into public.rights_image_evidence_policy(id,version,enabled,owner_decision_ref,closed_retention_days,erasure_default)
 values(true,'ordinary-photo-closed-30d-20261118',false,'owner-decision-20261118',30,'erase_with_account')
 on conflict(id) do nothing;

-- Privileged owner-approved configuration only; there is intentionally no
-- authenticated/service API to invent, extend or release a legal hold.
create table if not exists public.rights_image_evidence_holds(
 case_id uuid primary key, reason text not null check(length(btrim(reason)) between 3 and 2000),
 owner_authority_ref text not null check(length(btrim(owner_authority_ref)) between 3 and 300),
 review_at timestamptz not null, retain_on_account_erasure boolean not null default false
 constraint rights_image_evidence_no_erasure_retention check(not retain_on_account_erasure),
 created_at timestamptz not null default now(),released_at timestamptz,released_authority_ref text,
 check(released_at is null or length(btrim(released_authority_ref)) between 3 and 300)
);
create table if not exists public.rights_image_evidence(
 id uuid primary key default gen_random_uuid(),case_id uuid not null,report_id uuid not null,
 actor_user_id uuid not null,request_id uuid not null,input_sha256 text not null,
 source_type text not null check(source_type in('beauty_post','salon_profile_look','salon_profile_update')),
 source_id uuid not null,source_author_id uuid not null,
 source_bucket text not null check(source_bucket in('beauty-profile-media','salon-profile-media')),
 source_path text not null,source_object_id uuid not null,source_version text not null check(length(source_version)>0),
 source_etag text not null check(length(source_etag)>0),sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 bytes bigint not null check(bytes between 1 and 512000),mime text not null default 'image/webp' check(mime='image/webp'),
 evidence_bucket text not null default 'rights-review-evidence' check(evidence_bucket='rights-review-evidence'),
 evidence_path text not null unique,private_object_id uuid,private_version text,private_etag text,
 safety_classification text not null default 'unknown' check(safety_classification in('unknown','ordinary','suspected_csam','known_csam')),
 reason text not null check(length(btrim(reason)) between 3 and 2000),
 reference_plan text not null default 'retain_shared' check(reference_plan='retain_shared'),
 removal_requested boolean not null default false,source_fenced_at timestamptz,
 status text not null check(status in('blocked_policy','escalation_required','capture_queued','capturing','evidence_ready','removal_blocked','removing','origin_removed','purging','purged','conflict','erasure_owned')),
 stage text check(stage in('capture','remove_origin','purge')),lease_token uuid,leased_until timestamptz,
 retain_until timestamptz,created_at timestamptz not null default now(),checked_at timestamptz,
 captured_at timestamptz,origin_removed_at timestamptz,purged_at timestamptz,last_error text,
 unique(actor_user_id,request_id),unique(case_id,source_bucket,source_path,source_object_id,source_version)
);
create index if not exists rights_image_evidence_due on public.rights_image_evidence(checked_at,created_at)
 where status not in('purged','conflict','escalation_required','erasure_owned');
create index if not exists rights_image_evidence_source on public.rights_image_evidence(source_bucket,source_path);
create table if not exists public.rights_image_evidence_audit(
 id uuid primary key default gen_random_uuid(),evidence_id uuid not null,case_id uuid not null,
 actor_user_id uuid,action text not null,created_at timestamptz not null default now()
);
create table if not exists public.rights_origin_removal_requests(
 actor_user_id uuid not null,request_id uuid not null,evidence_id uuid not null,
 expected_version text not null,input_sha256 text not null,reason text not null,
 result jsonb not null,created_at timestamptz not null default now(),primary key(actor_user_id,request_id)
);
alter table public.rights_image_evidence_policy enable row level security;
alter table public.rights_image_evidence_holds enable row level security;
alter table public.rights_image_evidence enable row level security;
alter table public.rights_image_evidence_audit enable row level security;
alter table public.rights_origin_removal_requests enable row level security;
revoke all on public.rights_image_evidence_policy,public.rights_image_evidence_holds,public.rights_image_evidence,public.rights_image_evidence_audit,public.rights_origin_removal_requests from public,anon,authenticated,service_role;

create or replace function public.rights_evidence_service()
returns boolean language sql stable set search_path=pg_catalog as $$
 select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role','')='service_role';
$$;
create or replace function public.rights_evidence_operator(p_report uuid,p_permission text,p_actor uuid default public.current_public_user_id())
returns boolean language sql volatile security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.platform_reports r
 join public.platform_admin_memberships m on m.id=r.assigned_membership_id
 join public.users u on u.id=m.user_id
 join public.platform_admin_role_permissions rp on rp.role_id=m.role_id
 join public.platform_admin_permissions p on p.id=rp.permission_id
 where r.id=p_report and m.user_id=p_actor and m.status='active' and u.status='active' and p.code=p_permission);
$$;
create or replace function public.rights_evidence_expiry(p_report uuid,p_case uuid)
returns timestamptz language sql volatile security definer set search_path=pg_catalog,public as $$
 select case when exists(select 1 from public.rights_image_evidence_holds h where h.case_id=p_case and h.released_at is null) then null
 when r.status='closed' and r.closed_at is not null then r.closed_at+interval '30 days' else null end
 from public.platform_reports r where r.id=p_report;
$$;
create or replace function public.rights_evidence_object_matches(p_bucket text,p_path text,p_id uuid,p_version text,p_etag text,p_sha text,p_bytes bigint)
returns boolean language sql volatile security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from storage.objects o where o.bucket_id=p_bucket and o.name=p_path and o.id=p_id
 and o.version=p_version and o.metadata->>'eTag'=p_etag and o.user_metadata->>'sha256'=p_sha
 and o.metadata->>'size'=p_bytes::text and o.metadata->>'mimetype'='image/webp');
$$;
create or replace function public.rights_evidence_special_risk(p_id uuid)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare e public.rights_image_evidence;
begin
 select * into e from public.rights_image_evidence where id=p_id;
 if not found then return true;end if;
 return e.safety_classification<>'ordinary'
 or exists(select 1 from public.rights_image_evidence other where other.sha256=e.sha256 and other.safety_classification<>'ordinary')
 or exists(select 1 from public.post_safety_cases c where c.reason='minor_safety' and (
 (c.source_type=e.source_type and c.source_id=e.source_id)
 or (c.source_type='beauty_post' and exists(select 1 from public.beauty_post_media m join public.public_post_images i on i.bucket=m.bucket and i.object_path=m.object_path where m.post_id=c.source_id and i.sha256=e.sha256))
 or (c.source_type in('salon_profile_look','salon_profile_update') and exists(select 1 from public.public_post_images i where i.bucket='salon-profile-media' and i.object_path=c.content_snapshot->>'media_path' and i.sha256=e.sha256))));
end $$;
create or replace function public.rights_evidence_ready(p_id uuid,p_require_operator boolean default true)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare e public.rights_image_evidence; deadline timestamptz;
begin
 select * into e from public.rights_image_evidence where id=p_id;
 if not found or e.safety_classification<>'ordinary' or not exists(select 1 from public.rights_image_evidence_policy where id and enabled)
 or not exists(select 1 from public.post_safety_cases c where c.id=e.case_id and c.source_type=e.source_type and c.source_id=e.source_id and c.reason<>'minor_safety')
 or not exists(select 1 from public.platform_reports where id=e.report_id)
 or exists(select 1 from public.rights_image_evidence_holds h where h.case_id=e.case_id and h.released_at is null and h.review_at<=clock_timestamp()) then return false;end if;
 -- A second case (or exact-byte duplicate) cannot route suspected/unknown
 -- illegal material through a different ordinary complaint's download lane.
 if public.rights_evidence_special_risk(e.id) then return false;end if;
 if p_require_operator and not exists(select 1 from public.platform_reports r join public.platform_admin_memberships m on m.id=r.assigned_membership_id
 where r.id=e.report_id and public.rights_evidence_operator(e.report_id,'admin.reports.update',m.user_id)
 and public.rights_evidence_operator(e.report_id,'admin.reports.read',m.user_id)) then return false;end if;
 deadline:=public.rights_evidence_expiry(e.report_id,e.case_id);
 return deadline is null or deadline>clock_timestamp();
end $$;
create or replace function public.rights_evidence_public_references(p_id uuid)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare e public.rights_image_evidence;ad_reference boolean:=false;
begin
 select * into e from public.rights_image_evidence where id=p_id;
 if not found then return true;end if;
 if to_regclass('public.ad_report_evidence') is not null then
  execute 'select exists(select 1 from public.ad_report_evidence where snapshot->>''mediaBucket''=$1 and snapshot->>''mediaPath''=$2)'
   into ad_reference using e.source_bucket,e.source_path;
 end if;
 -- Every extant case on the same object needs its own approved private receipt.
 -- Do not turn one complainant's case into evidence loss for another case.
 return ad_reference or public.public_post_media_has_reference(e.source_bucket,e.source_path)
 or exists(select 1 from public.post_safety_cases c where
 ((c.source_type=e.source_type and c.source_id=e.source_id)
 or (e.source_bucket='beauty-profile-media' and c.source_type='beauty_post' and exists(select 1 from public.beauty_post_media m where m.post_id=c.source_id and m.bucket=e.source_bucket and m.object_path=e.source_path))
 or (e.source_bucket='salon-profile-media' and c.source_type in('salon_profile_look','salon_profile_update') and c.content_snapshot->>'media_path'=e.source_path))
 and not exists(select 1 from public.rights_image_evidence other where other.case_id=c.id and other.source_bucket=e.source_bucket and other.source_path=e.source_path
 and other.source_object_id=e.source_object_id and other.sha256=e.sha256 and other.captured_at is not null and other.purged_at is null
 and public.rights_evidence_ready(other.id,false)
 and public.rights_evidence_object_matches(other.evidence_bucket,other.evidence_path,other.private_object_id,other.private_version,other.private_etag,other.sha256,other.bytes)));
end $$;

-- Operator input contains only a canonical case and a server-enumerated opaque
-- manifest object ID. No arbitrary bucket/path/URL or claimant download exists.
create or replace function public.request_rights_image_evidence(p_case_id uuid,p_object_id uuid,p_request_id uuid,p_safety_classification text,p_reason text,p_remove_origin boolean default false)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare c public.post_safety_cases;i public.public_post_images;e public.rights_image_evidence;rid uuid;actor uuid:=public.current_public_user_id();fingerprint text;eid uuid:=gen_random_uuid();
begin
 select * into c from public.post_safety_cases where id=p_case_id;
 if not found then raise exception 'Case unavailable.' using errcode='42501';end if;
 select report_id into rid from public.review_support_links where kind='post_report' and request_id=c.id;
 rid:=coalesce(rid,c.platform_report_id);
 if actor is null or not public.rights_evidence_operator(rid,'admin.reports.read') or not public.rights_evidence_operator(rid,'admin.reports.update') then raise exception 'Assigned case operator required.' using errcode='42501';end if;
 if p_request_id is null or p_safety_classification not in('unknown','ordinary','suspected_csam','known_csam') or length(btrim(p_reason)) not between 3 and 2000 then raise exception 'Invalid evidence request.';end if;
 if p_remove_origin is distinct from false then raise exception 'Origin removal requires a separate reviewed decision.';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(p_case_id,p_object_id,p_safety_classification,btrim(p_reason),p_remove_origin)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('rights-evidence:'||actor||':'||p_request_id,0));
 select * into e from public.rights_image_evidence where actor_user_id=actor and request_id=p_request_id;
 if found then
  if e.input_sha256<>fingerprint then raise exception 'Evidence request ID reused.' using errcode='22023';end if;
  return jsonb_build_object('id',e.id,'status',e.status);
 end if;
 select * into i from public.public_post_images where object_id=p_object_id and status='approved';
 if i.uploaded_by_user_id is null then raise exception 'Pinned approved photo unavailable.';end if;
 perform 1 from public.users where id=i.uploaded_by_user_id and status='active' for share nowait;
 if not found then raise exception 'Photo author unavailable.';end if;
 if p_safety_classification<>'ordinary' and not pg_try_advisory_xact_lock(hashtextextended('rights-image-risk:'||i.sha256,0)) then raise exception 'Photo risk transition is busy.' using errcode='55P03';end if;
 select * into i from public.public_post_images where bucket=i.bucket and object_path=i.object_path and status='approved' for share nowait;
 select * into c from public.post_safety_cases where id=c.id for share nowait;
 select report_id into rid from public.review_support_links where kind='post_report' and request_id=c.id;
 rid:=coalesce(rid,c.platform_report_id);
 if not public.rights_evidence_operator(rid,'admin.reports.read') or not public.rights_evidence_operator(rid,'admin.reports.update') then raise exception 'Assigned case operator required.' using errcode='42501';end if;
 if i.public_deletion_fenced_at is not null or i.sha256 is null or i.bytes is null
 or not public.rights_evidence_object_matches(i.bucket,i.object_path,i.object_id,i.object_version,i.object_etag,i.sha256,i.bytes)
 or not ((c.source_type='beauty_post' and exists(select 1 from public.beauty_post_media m where m.post_id=c.source_id and m.bucket=i.bucket and m.object_path=i.object_path))
 or (c.source_type in('salon_profile_look','salon_profile_update') and i.bucket='salon-profile-media' and c.content_snapshot->>'media_path'=i.object_path)) then raise exception 'Case photo identity unavailable.';end if;
 insert into public.rights_image_evidence(id,case_id,report_id,actor_user_id,request_id,input_sha256,source_type,source_id,source_author_id,source_bucket,source_path,source_object_id,source_version,source_etag,sha256,bytes,evidence_path,safety_classification,reason,removal_requested,status)
 values(eid,c.id,rid,actor,p_request_id,fingerprint,c.source_type,c.source_id,i.uploaded_by_user_id,i.bucket,i.object_path,i.object_id,i.object_version,i.object_etag,i.sha256,i.bytes,
 'v1/'||c.id||'/'||eid||'.webp',p_safety_classification,btrim(p_reason),coalesce(p_remove_origin,false),
 case when p_safety_classification<>'ordinary' or c.reason='minor_safety' then 'escalation_required' else 'blocked_policy' end)
 on conflict(case_id,source_bucket,source_path,source_object_id,source_version) do nothing returning * into e;
 if not found then raise exception 'This exact case photo already has an evidence request.' using errcode='22023';end if;
 insert into public.rights_image_evidence_audit(evidence_id,case_id,actor_user_id,action) values(e.id,c.id,actor,'requested');
 return jsonb_build_object('id',e.id,'status',e.status);
end $$;

create or replace function public.rights_evidence_lock(p_id uuid)
returns public.rights_image_evidence language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare e public.rights_image_evidence;
begin
 select * into e from public.rights_image_evidence where id=p_id;
 if not found then return null;end if;
 -- Never wait back on a Storage/post/report row under the manifest lock.
 perform 1 from public.users where id=e.source_author_id for share nowait;
 if not found then return null;end if;
 if not pg_try_advisory_xact_lock_shared(hashtextextended('rights-image-risk:'||e.sha256,0)) then raise exception 'Photo risk transition is busy.' using errcode='55P03';end if;
 perform 1 from public.public_post_images where bucket=e.source_bucket and object_path=e.source_path for share nowait;
 select * into e from public.rights_image_evidence where id=p_id for update nowait;
 perform 1 from public.platform_reports where id=e.report_id for share nowait;
 return e;
end $$;
create or replace function public.rights_evidence_row(p_id uuid,p_stage text)
returns jsonb language sql volatile security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object('id',e.id,'case_id',e.case_id,'stage',p_stage,'source_bucket',e.source_bucket,'source_path',e.source_path,
 'source_object_id',e.source_object_id,'source_version',e.source_version,'source_etag',e.source_etag,'sha256',e.sha256,'bytes',e.bytes,'mime',e.mime,
 'evidence_bucket',e.evidence_bucket,'evidence_path',e.evidence_path,'private_object_id',e.private_object_id,'private_version',e.private_version,'private_etag',e.private_etag,
 'lease_token',case when p_stage='read' then null else e.lease_token end,'leased_until',case when p_stage='read' then null else e.leased_until end,
 'retain_until',public.rights_evidence_expiry(e.report_id,e.case_id)) from public.rights_image_evidence e where e.id=p_id;
$$;
create or replace function public.rights_evidence_erasure_owns(p_id uuid)
returns boolean language sql volatile security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.rights_image_evidence e join public.account_erasure_jobs j on j.user_id=e.source_author_id where e.id=p_id)
 or exists(select 1 from public.rights_image_evidence e join public.account_erasure_objects a on a.bucket_id=e.source_bucket and a.object_path=e.source_path where e.id=p_id);
$$;
create or replace function public.get_admin_rights_image_evidence_state(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare e public.rights_image_evidence;blocked text;fingerprint text;hold_row public.rights_image_evidence_holds;can_write boolean;
begin
 e:=public.rights_evidence_lock(p_id);
 if e.id is null or not public.rights_evidence_operator(e.report_id,'admin.reports.read') then raise exception 'Assigned case operator required.' using errcode='42501';end if;
 can_write:=public.rights_evidence_operator(e.report_id,'admin.reports.update');
 select * into hold_row from public.rights_image_evidence_holds where case_id=e.case_id and released_at is null;
 if not can_write then blocked:='permission';
 elsif e.purged_at is not null or e.origin_removed_at is not null or e.status in('conflict','purging') then blocked:='unavailable';
 elsif not public.rights_evidence_ready(e.id) then blocked:='policy_or_safety';
 elsif e.captured_at is null or not public.rights_evidence_object_matches(e.evidence_bucket,e.evidence_path,e.private_object_id,e.private_version,e.private_etag,e.sha256,e.bytes) then blocked:='capture_required';
 elsif public.rights_evidence_erasure_owns(e.id) or not exists(select 1 from public.users where id=e.source_author_id and status='active') then blocked:='erasure_owned';
 elsif public.rights_evidence_public_references(e.id) then blocked:='shared_references';
 elsif e.removal_requested then blocked:='already_requested';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(e.id,e.source_object_id,e.source_version,e.source_etag,e.sha256,e.bytes,e.private_object_id,e.private_version,e.private_etag,e.captured_at,e.origin_removed_at,e.purged_at,e.safety_classification,e.removal_requested,blocked,
 public.rights_evidence_expiry(e.report_id,e.case_id),hold_row.owner_authority_ref,hold_row.review_at,
 (select status from public.platform_reports where id=e.report_id),
 (select jsonb_build_array(version,enabled) from public.rights_image_evidence_policy where id))::text,'UTF8')),'hex');
 return jsonb_build_object('id',e.id,'caseId',e.case_id,'status',e.status,'version',fingerprint,'captured',e.captured_at is not null,'originRemoved',e.origin_removed_at is not null,
 'safetyClassification',e.safety_classification,'retainUntil',public.rights_evidence_expiry(e.report_id,e.case_id),'hasLegalHold',hold_row.case_id is not null,'legalHoldReviewAt',hold_row.review_at,
 'canRequestRemoval',blocked is null,'removalBlockedReason',blocked);
exception when lock_not_available then return null;
end $$;
create or replace function public.request_rights_origin_removal(p_evidence_id uuid,p_request_id uuid,p_expected_version text,p_reason text)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare e public.rights_image_evidence;actor uuid:=public.current_public_user_id();saved public.rights_origin_removal_requests;input_hash text;current_state jsonb;result jsonb;
begin
 e:=public.rights_evidence_lock(p_evidence_id);
 if e.id is null or not public.rights_evidence_operator(e.report_id,'admin.reports.read') or not public.rights_evidence_operator(e.report_id,'admin.reports.update') then raise exception 'Assigned case operator required.' using errcode='42501';end if;
 if p_request_id is null or coalesce(p_expected_version,'') !~ '^[a-f0-9]{64}$' or coalesce(length(btrim(p_reason)),0) not between 3 and 2000 then raise exception 'Invalid removal decision.';end if;
 input_hash:=encode(sha256(convert_to(jsonb_build_array(p_evidence_id,p_expected_version,btrim(p_reason))::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('rights-origin-decision:'||actor||':'||p_request_id,0));
 select * into saved from public.rights_origin_removal_requests where actor_user_id=actor and request_id=p_request_id;
 if found then
  if saved.input_sha256<>input_hash then return jsonb_build_object('ok',false,'code','conflict');end if;
  return saved.result;
 end if;
 current_state:=public.get_admin_rights_image_evidence_state(e.id);
 if current_state->>'version' is distinct from p_expected_version then return jsonb_build_object('ok',false,'code','stale','state',current_state);end if;
 if current_state->>'canRequestRemoval' is distinct from 'true' then return jsonb_build_object('ok',false,'code','unavailable','state',current_state);end if;
 update public.rights_image_evidence set removal_requested=true,checked_at=null where id=e.id;
 insert into public.rights_image_evidence_audit(evidence_id,case_id,actor_user_id,action) values(e.id,e.case_id,actor,'origin_removal_requested');
 result:=jsonb_build_object('ok',true,'state',public.get_admin_rights_image_evidence_state(e.id));
 insert into public.rights_origin_removal_requests(actor_user_id,request_id,evidence_id,expected_version,input_sha256,reason,result) values(actor,p_request_id,e.id,p_expected_version,input_hash,btrim(p_reason),result);
 return result;
exception when lock_not_available then return jsonb_build_object('ok',false,'code','unavailable');
end $$;
create or replace function public.guard_rights_evidence_immutable_history()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'Rights evidence decision history is immutable.';end $$;
drop trigger if exists rights_evidence_immutable_history on public.rights_origin_removal_requests;
create trigger rights_evidence_immutable_history before update or delete on public.rights_origin_removal_requests for each row execute function public.guard_rights_evidence_immutable_history();
drop trigger if exists rights_evidence_immutable_audit on public.rights_image_evidence_audit;
create trigger rights_evidence_immutable_audit before update or delete on public.rights_image_evidence_audit for each row execute function public.guard_rights_evidence_immutable_history();
create or replace function public.revalidate_rights_image_evidence(p_id uuid,p_lease uuid)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare e public.rights_image_evidence;expiry timestamptz;
begin
 if not public.rights_evidence_service() then raise exception 'Service required.' using errcode='42501';end if;
 e:=public.rights_evidence_lock(p_id);
 if e.id is null or e.lease_token is distinct from p_lease or e.leased_until is null or e.leased_until<=clock_timestamp() then return false;end if;
 expiry:=public.rights_evidence_expiry(e.report_id,e.case_id);
 if e.stage='purge' then
  return e.status='purging' and expiry is not null and expiry<=clock_timestamp()
  and not public.rights_evidence_special_risk(e.id)
  and not exists(select 1 from public.rights_image_evidence_holds where case_id=e.case_id and released_at is null)
  and public.rights_evidence_object_matches(e.evidence_bucket,e.evidence_path,e.private_object_id,e.private_version,e.private_etag,e.sha256,e.bytes);
 end if;
 if not public.rights_evidence_ready(e.id) or public.rights_evidence_erasure_owns(e.id)
 or not exists(select 1 from public.users where id=e.source_author_id and status='active') then return false;end if;
 if e.stage='capture' then
  return e.status='capturing' and public.rights_evidence_object_matches(e.source_bucket,e.source_path,e.source_object_id,e.source_version,e.source_etag,e.sha256,e.bytes);
 end if;
 return e.stage='remove_origin' and e.status='removing' and e.source_fenced_at is not null and e.captured_at is not null
 and not public.rights_evidence_public_references(e.id)
 and public.rights_evidence_object_matches(e.evidence_bucket,e.evidence_path,e.private_object_id,e.private_version,e.private_etag,e.sha256,e.bytes)
 and (public.rights_evidence_object_matches(e.source_bucket,e.source_path,e.source_object_id,e.source_version,e.source_etag,e.sha256,e.bytes)
 or not exists(select 1 from storage.objects where bucket_id=e.source_bucket and name=e.source_path));
exception when lock_not_available then return false;
end $$;

create or replace function public.claim_rights_image_evidence(p_stage text,p_limit integer default 1)
returns setof jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare candidate record;e public.rights_image_evidence;o storage.objects;expiry timestamptz;n integer:=0;
begin
 if not public.rights_evidence_service() then raise exception 'Service required.' using errcode='42501';end if;
 if p_stage not in('capture','remove_origin','purge') then raise exception 'Invalid stage.';end if;
 for candidate in select id from public.rights_image_evidence
 where status not in('purged','conflict','escalation_required','erasure_owned')
 and ((p_stage='capture' and captured_at is null)
 or (p_stage='remove_origin' and captured_at is not null and removal_requested and origin_removed_at is null)
 or (p_stage='purge' and not public.rights_evidence_special_risk(id) and public.rights_evidence_expiry(report_id,case_id)<=clock_timestamp()
 and not exists(select 1 from public.rights_image_evidence_holds h where h.case_id=rights_image_evidence.case_id and h.released_at is null)))
 and (leased_until is null or leased_until<=clock_timestamp()) and (checked_at is null or checked_at<clock_timestamp()-interval '1 minute')
 order by checked_at nulls first,created_at,id limit 30 loop
 begin
  e:=public.rights_evidence_lock(candidate.id);
  if e.id is null or e.leased_until>clock_timestamp() then continue;end if;
  expiry:=public.rights_evidence_expiry(e.report_id,e.case_id);
  if p_stage='purge' then
   if public.rights_evidence_special_risk(e.id) or expiry is null or expiry>clock_timestamp() or exists(select 1 from public.rights_image_evidence_holds where case_id=e.case_id and released_at is null) then continue;end if;
   select * into o from storage.objects where bucket_id=e.evidence_bucket and name=e.evidence_path;
   if not found then update public.rights_image_evidence set status='purged',purged_at=clock_timestamp(),lease_token=null,leased_until=null where id=e.id;continue;end if;
   if o.user_metadata->>'sha256' is distinct from e.sha256 or o.metadata->>'size' is distinct from e.bytes::text or o.metadata->>'mimetype' is distinct from 'image/webp' then
    update public.rights_image_evidence set status='conflict',last_error='private_mismatch',checked_at=clock_timestamp() where id=e.id;continue;
   end if;
   update public.rights_image_evidence set private_object_id=o.id,private_version=o.version,private_etag=o.metadata->>'eTag' where id=e.id;
  else
   if not public.rights_evidence_ready(e.id) then update public.rights_image_evidence set checked_at=clock_timestamp() where id=e.id;continue;end if;
   if public.rights_evidence_erasure_owns(e.id) or not exists(select 1 from public.users where id=e.source_author_id and status='active') then
    update public.rights_image_evidence set status='erasure_owned',checked_at=clock_timestamp() where id=e.id;continue;
   end if;
   if p_stage='capture' then
    if e.captured_at is not null then continue;end if;
    if not public.rights_evidence_object_matches(e.source_bucket,e.source_path,e.source_object_id,e.source_version,e.source_etag,e.sha256,e.bytes) then
     update public.rights_image_evidence set status='conflict',last_error='source_mismatch',checked_at=clock_timestamp() where id=e.id;continue;
    end if;
   else
    if not e.removal_requested or e.captured_at is null or e.origin_removed_at is not null then continue;end if;
    if public.rights_evidence_public_references(e.id) then update public.rights_image_evidence set status='removal_blocked',checked_at=clock_timestamp() where id=e.id;continue;end if;
    if not public.rights_evidence_object_matches(e.evidence_bucket,e.evidence_path,e.private_object_id,e.private_version,e.private_etag,e.sha256,e.bytes) then continue;end if;
    if exists(select 1 from storage.objects where bucket_id=e.source_bucket and name=e.source_path)
    and not public.rights_evidence_object_matches(e.source_bucket,e.source_path,e.source_object_id,e.source_version,e.source_etag,e.sha256,e.bytes) then
     update public.rights_image_evidence set status='conflict',last_error='source_mismatch',checked_at=clock_timestamp() where id=e.id;continue;
    end if;
    -- Own the shared manifest UPDATE before installing its permanent fence.
    perform 1 from public.public_post_images where bucket=e.source_bucket and object_path=e.source_path for update nowait;
    if not found then continue;end if;
    update public.public_post_images set public_deletion_fenced_at=coalesce(public_deletion_fenced_at,clock_timestamp()) where bucket=e.source_bucket and object_path=e.source_path;
    update public.rights_image_evidence set source_fenced_at=coalesce(source_fenced_at,clock_timestamp()) where id=e.id;
   end if;
  end if;
  update public.rights_image_evidence set status=case p_stage when 'capture' then 'capturing' when 'remove_origin' then 'removing' else 'purging' end,
   stage=p_stage,lease_token=gen_random_uuid(),leased_until=clock_timestamp()+interval '5 minutes',checked_at=clock_timestamp(),retain_until=expiry,last_error=null
   where id=e.id returning * into e;
  return next public.rights_evidence_row(e.id,p_stage);n:=n+1;
  exit when n>=greatest(1,least(coalesce(p_limit,1),3));
 exception when lock_not_available then continue;end;
 end loop;
end $$;

create or replace function public.finish_rights_image_evidence_capture(p_id uuid,p_lease uuid)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare e public.rights_image_evidence;o storage.objects;
begin
 if not public.revalidate_rights_image_evidence(p_id,p_lease) then return false;end if;
 select * into e from public.rights_image_evidence where id=p_id;
 if e.stage<>'capture' then return false;end if;
 select * into o from storage.objects where bucket_id=e.evidence_bucket and name=e.evidence_path;
 if not found or o.user_metadata->>'sha256' is distinct from e.sha256 or o.metadata->>'size' is distinct from e.bytes::text
 or o.metadata->>'mimetype' is distinct from 'image/webp' or coalesce(o.version,'')='' or coalesce(o.metadata->>'eTag','')='' then return false;end if;
 update public.rights_image_evidence set private_object_id=o.id,private_version=o.version,private_etag=o.metadata->>'eTag',
 captured_at=clock_timestamp(),status='evidence_ready',stage=null,leased_until=null where id=p_id;
 insert into public.rights_image_evidence_audit(evidence_id,case_id,action) values(e.id,e.case_id,'capture_verified');
 return true;
end $$;
create or replace function public.finish_rights_image_evidence_removal(p_id uuid,p_lease uuid)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare e public.rights_image_evidence;
begin
 if not public.revalidate_rights_image_evidence(p_id,p_lease) then return false;end if;
 select * into e from public.rights_image_evidence where id=p_id;
 if e.stage<>'remove_origin' or exists(select 1 from storage.objects where bucket_id=e.source_bucket and name=e.source_path) then return false;end if;
 perform 1 from public.salon_profile_media_assets where bucket=e.source_bucket and object_path=e.source_path for update nowait;
 update public.rights_image_evidence set origin_removed_at=clock_timestamp(),status='origin_removed',stage=null,leased_until=null where id=p_id;
 update public.public_post_images set public_deleted_at=coalesce(public_deleted_at,clock_timestamp()) where bucket=e.source_bucket and object_path=e.source_path;
 update public.salon_profile_media_assets set status='deleted',deleted_at=coalesce(deleted_at,clock_timestamp()) where bucket=e.source_bucket and object_path=e.source_path;
 insert into public.rights_image_evidence_audit(evidence_id,case_id,action) values(e.id,e.case_id,'origin_absent');
 return true;
exception when lock_not_available then return false;
end $$;
create or replace function public.finish_rights_image_evidence_purge(p_id uuid,p_lease uuid)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare e public.rights_image_evidence;expiry timestamptz;
begin
 if not public.rights_evidence_service() then raise exception 'Service required.' using errcode='42501';end if;
 e:=public.rights_evidence_lock(p_id);expiry:=public.rights_evidence_expiry(e.report_id,e.case_id);
 if e.id is null or e.stage is distinct from 'purge' or e.status<>'purging' or e.lease_token is distinct from p_lease or e.leased_until is null or e.leased_until<=clock_timestamp()
 or public.rights_evidence_special_risk(e.id) or expiry is null or expiry>clock_timestamp() or exists(select 1 from public.rights_image_evidence_holds where case_id=e.case_id and released_at is null)
 or exists(select 1 from storage.objects where bucket_id=e.evidence_bucket and name=e.evidence_path) then return false;end if;
 update public.rights_image_evidence set status='purged',purged_at=clock_timestamp(),stage=null,leased_until=null where id=p_id;
 insert into public.rights_image_evidence_audit(evidence_id,case_id,action) values(e.id,e.case_id,'private_absent');return true;
exception when lock_not_available then return false;
end $$;
create or replace function public.fail_rights_image_evidence(p_id uuid,p_lease uuid,p_error text)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare e public.rights_image_evidence;
begin
 if not public.rights_evidence_service() then raise exception 'Service required.' using errcode='42501';end if;
 if p_error not in('source_mismatch','private_mismatch','storage_failed','time_budget') then raise exception 'Invalid outcome.';end if;
 e:=public.rights_evidence_lock(p_id);
 if e.id is null or e.lease_token is distinct from p_lease or e.leased_until is null or e.leased_until<=clock_timestamp() then return false;end if;
 update public.rights_image_evidence set status=case when p_error in('source_mismatch','private_mismatch') then 'conflict' when captured_at is null then 'capture_queued' else 'evidence_ready' end,
 last_error=p_error,stage=null,lease_token=null,leased_until=null,checked_at=clock_timestamp() where id=p_id;return true;
exception when lock_not_available then return false;
end $$;

create or replace function public.authorize_rights_image_evidence_read(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare e public.rights_image_evidence;
begin
 e:=public.rights_evidence_lock(p_id);
 if e.id is null or e.captured_at is null or e.purged_at is not null or e.status in('purging','conflict','escalation_required','erasure_owned')
 or not public.rights_evidence_ready(e.id,false) or not public.rights_evidence_operator(e.report_id,'admin.reports.read')
 or not public.rights_evidence_object_matches(e.evidence_bucket,e.evidence_path,e.private_object_id,e.private_version,e.private_etag,e.sha256,e.bytes)
 or (exists(select 1 from public.account_erasure_jobs where user_id=e.source_author_id)
 and not exists(select 1 from public.rights_image_evidence_holds where case_id=e.case_id and released_at is null and retain_on_account_erasure)) then return null;end if;
 insert into public.rights_image_evidence_audit(evidence_id,case_id,actor_user_id,action) values(e.id,e.case_id,public.current_public_user_id(),'read_authorized');
 return public.rights_evidence_row(e.id,'read');
exception when lock_not_available then return null;
end $$;

-- Private bucket has no ordinary direct access/signing. Restrictive policies
-- remain effective even if an older broad permissive policy also matches.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('rights-review-evidence','rights-review-evidence',false,512000,array['image/webp']) on conflict(id) do nothing;
do $bucket$ begin
 if not exists(select 1 from storage.buckets where id='rights-review-evidence' and not public and file_size_limit=512000 and allowed_mime_types=array['image/webp']) then
 raise exception 'Rights evidence bucket collision; review configuration.';end if;
end $bucket$;
drop policy if exists rights_evidence_no_client_read on storage.objects;
create policy rights_evidence_no_client_read on storage.objects as restrictive for select to anon,authenticated using(bucket_id<>'rights-review-evidence');
drop policy if exists rights_evidence_no_client_insert on storage.objects;
create policy rights_evidence_no_client_insert on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id<>'rights-review-evidence');
drop policy if exists rights_evidence_no_client_update on storage.objects;
create policy rights_evidence_no_client_update on storage.objects as restrictive for update to anon,authenticated using(bucket_id<>'rights-review-evidence') with check(bucket_id<>'rights-review-evidence');
drop policy if exists rights_evidence_no_client_delete on storage.objects;
create policy rights_evidence_no_client_delete on storage.objects as restrictive for delete to anon,authenticated using(bucket_id<>'rights-review-evidence');

create or replace function public.guard_rights_image_evidence_storage()
returns trigger language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare b text;p text;e public.rights_image_evidence;erasure boolean;
begin
 b:=case when tg_op='DELETE' then old.bucket_id else new.bucket_id end;p:=case when tg_op='DELETE' then old.name else new.name end;
 -- Explicit direct database maintenance remains separate from client/service APIs.
 if session_user in('postgres','supabase_admin') and current_setting('role',true) in('none','postgres','supabase_admin') then return case when tg_op='DELETE' then old else new end;end if;
 if b='rights-review-evidence' or (tg_op='UPDATE' and old.bucket_id='rights-review-evidence') then
  if not public.rights_evidence_service() or storage.allow_any_operation(array['object.upload_signed']) then raise exception 'Private evidence operation denied.' using errcode='42501';end if;
  select * into e from public.rights_image_evidence where evidence_bucket=b and evidence_path=p;
  if not found then raise exception 'Unknown private evidence.' using errcode='42501';end if;
  e:=public.rights_evidence_lock(e.id);
  erasure:=exists(select 1 from public.account_erasure_objects a join public.account_erasure_jobs j on j.user_id=a.user_id
   where a.user_id=e.source_author_id and a.bucket_id=b and a.object_path=p and a.disposition='purge' and a.completed_at is null
   and j.status='processing' and j.leased_until>clock_timestamp());
  if tg_op='DELETE' then
   if erasure and not public.rights_evidence_special_risk(e.id) then return old;end if;
   if not storage.allow_any_operation(array['object.delete','object.delete_many']) or e.stage<>'purge' or not public.revalidate_rights_image_evidence(e.id,e.lease_token) then raise exception 'Evidence purge not authorized.' using errcode='42501';end if;
   return old;
  end if;
  if tg_op<>'INSERT' or not storage.allow_only_operation('object.upload') or e.stage<>'capture'
  or not public.revalidate_rights_image_evidence(e.id,e.lease_token) or e.captured_at is not null or e.purged_at is not null
  -- Storage's rolled-back canUpload probe uses version=1/contentLength;
  -- its final committed object uses actual version/size. Both are exact-size
  -- checks; checkpoint never accepts the permission-probe representation.
  or not coalesce((new.metadata->>'size'=e.bytes::text or (new.version='1' and not(new.metadata?'size') and new.metadata->>'contentLength'=e.bytes::text)),false)
  or new.metadata->>'mimetype' is distinct from 'image/webp' or new.user_metadata->>'sha256' is distinct from e.sha256
  then raise exception 'Immutable private capture denied.' using errcode='42501';end if;
  return new;
 end if;
 select * into e from public.rights_image_evidence where source_bucket=b and source_path=p order by source_fenced_at nulls last,created_at limit 1;
 if not found then return case when tg_op='DELETE' then old else new end;end if;
 -- Keep the shipped exact-existing-byte leased retain_business COPY exception.
 if tg_op<>'DELETE' and storage.allow_only_operation('object.copy') and exists(select 1 from public.account_erasure_objects where bucket_id=b and object_path=p and disposition='retain_business' and completed_at is null) then return new;end if;
 if tg_op<>'DELETE' then raise exception 'Case photo identity is frozen.' using errcode='42501';end if;
 -- Existing erasure retains its independent exact-path purge authority.
 if exists(select 1 from public.account_erasure_objects a join public.account_erasure_jobs j on j.user_id=a.user_id
 where a.bucket_id=b and a.object_path=p and a.disposition='purge' and a.completed_at is null and j.status='processing' and j.leased_until>clock_timestamp()) then return old;end if;
 if not public.rights_evidence_service() or not storage.allow_any_operation(array['object.delete','object.delete_many']) then raise exception 'Origin removal denied.' using errcode='42501';end if;
 for e in select * from public.rights_image_evidence where source_bucket=b and source_path=p and stage='remove_origin' and status='removing' order by id loop
  if e.source_object_id=old.id and e.source_version=old.version and e.source_etag=old.metadata->>'eTag'
  and e.sha256=old.user_metadata->>'sha256' and e.bytes::text=old.metadata->>'size' and old.metadata->>'mimetype'='image/webp'
  and public.revalidate_rights_image_evidence(e.id,e.lease_token) then return old;end if;
 end loop;
 raise exception 'Origin removal lease or references changed.' using errcode='42501';
end $$;
drop trigger if exists ab_rights_image_evidence_storage on storage.objects;
create trigger ab_rights_image_evidence_storage before insert or update or delete on storage.objects for each row execute function public.guard_rights_image_evidence_storage();

-- Lifecycle changes serialize with final purge. Reopen does not resurrect a
-- purged key; an active purge must finish/expire before a new case state commits.
create or replace function public.guard_rights_evidence_case_lifecycle()
returns trigger language plpgsql volatile security definer set search_path=pg_catalog,public as $$
begin
 if new.status is distinct from old.status or new.closed_at is distinct from old.closed_at then
  if exists(select 1 from public.rights_image_evidence where report_id=old.id and status='purging' and leased_until>clock_timestamp()) then
   raise exception 'Evidence purge is in progress. Retry the case update.' using errcode='55P03';
  end if;
 end if;return new;
end $$;
drop trigger if exists aa_rights_evidence_case_lifecycle on public.platform_reports;
create trigger aa_rights_evidence_case_lifecycle before update on public.platform_reports for each row execute function public.guard_rights_evidence_case_lifecycle();

-- New/changed minor-safety case flags serialize with private Storage commits
-- for that known exact-byte hash. No network transaction or persistent global
-- blacklist is created. Ordinary case communication does not take this fence.
create or replace function public.guard_rights_evidence_case_risk()
returns trigger language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare prior jsonb;current_item jsonb;pin record;
begin
 if tg_op<>'INSERT' then prior:=to_jsonb(old);end if;
 if tg_op<>'DELETE' then current_item:=to_jsonb(new);end if;
 if coalesce(prior->>'reason','')<>'minor_safety' and coalesce(current_item->>'reason','')<>'minor_safety' then return case when tg_op='DELETE' then old else new end;end if;
 if tg_op='UPDATE' and new.reason=old.reason and new.source_type=old.source_type and new.source_id=old.source_id and new.content_snapshot=old.content_snapshot then return new;end if;
 for pin in select distinct i.sha256 from public.public_post_images i where i.sha256 is not null and (
 (i.bucket='beauty-profile-media' and exists(select 1 from public.beauty_post_media m where m.bucket=i.bucket and m.object_path=i.object_path and m.post_id in(nullif(prior->>'source_id','')::uuid,nullif(current_item->>'source_id','')::uuid)))
 or (i.bucket='salon-profile-media' and i.object_path in(prior#>>'{content_snapshot,media_path}',current_item#>>'{content_snapshot,media_path}')))
 union select e.sha256 from public.rights_image_evidence e where e.case_id in(nullif(prior->>'id','')::uuid,nullif(current_item->>'id','')::uuid)
 order by sha256 loop
  if not pg_try_advisory_xact_lock(hashtextextended('rights-image-risk:'||pin.sha256,0)) then raise exception 'Photo risk transition is busy.' using errcode='55P03';end if;
 end loop;
 return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists ab_rights_evidence_case_risk on public.post_safety_cases;
create trigger ab_rights_evidence_case_risk before insert or update or delete on public.post_safety_cases for each row execute function public.guard_rights_evidence_case_risk();

-- Holds are privileged owner decisions, not an ordinary reporter/operator
-- switch. Serialize the decision with the report lock held by Storage DELETE;
-- cancel an unspent purge lease, never claim that an in-flight deletion stopped.
create or replace function public.guard_rights_evidence_hold()
returns trigger language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare rid uuid;
begin
 if tg_op='DELETE' then raise exception 'Release an approved hold with its authority receipt; do not delete its history.';end if;
 if tg_op='UPDATE' and (new.case_id<>old.case_id or new.owner_authority_ref<>old.owner_authority_ref or new.reason<>old.reason or new.created_at<>old.created_at) then raise exception 'Hold authority is immutable.';end if;
 select report_id into rid from public.rights_image_evidence where case_id=new.case_id order by created_at limit 1;
 if rid is not null then
  perform 1 from public.platform_reports where id=rid for update nowait;
  perform 1 from public.rights_image_evidence where case_id=new.case_id for update nowait;
  if new.released_at is null then
   update public.rights_image_evidence set status=case when captured_at is null then 'capture_queued' else 'evidence_ready' end,
    stage=null,lease_token=null,leased_until=null,checked_at=null where case_id=new.case_id and status='purging';
  end if;
 end if;
 return new;
end $$;
drop trigger if exists aa_rights_evidence_hold on public.rights_image_evidence_holds;
create trigger aa_rights_evidence_hold before insert or update or delete on public.rights_image_evidence_holds for each row execute function public.guard_rights_evidence_hold();

-- A permanent tombstone survives manifest/account erasure. All actual new
-- publication references still use the shared user -> manifest fence.
do $fence$ declare d text;needle text;begin
 d:=pg_get_functiondef('public.lock_public_post_media_reference(text,text)'::regprocedure);
 needle:='if p is null then return;end if;';
 if strpos(d,'rights_image_evidence')=0 then
  if strpos(d,needle)=0 then raise exception 'Public media fence changed.';end if;
  execute replace(d,needle,needle||E'\n if exists(select 1 from public.rights_image_evidence where source_bucket=b and source_path=p and source_fenced_at is not null) then raise exception ''Removed photo cannot be reattached.'' using errcode=''42501'';end if;');
 end if;
 d:=pg_get_functiondef('public.guard_public_post_media_reference()'::regprocedure);
 needle:='elsif tg_table_name=''post_safety_cases'' then';
 if strpos(d,'rights_image_evidence')=0 then
  if strpos(d,needle)=0 then raise exception 'Case media reference guard changed.';end if;
  execute replace(d,needle,needle||E'\n  if tg_op=''UPDATE'' and new.source_type=old.source_type and new.source_id=old.source_id and new.content_snapshot=old.content_snapshot and exists(select 1 from public.rights_image_evidence where case_id=old.id and captured_at is not null) then return new;end if;');
 end if;
end $fence$;

-- Service-created private captures are not end-user Storage owned. Plan their
-- exact RESERVED paths before tombstoning manifests; deny all late uploads.
do $erasure$ declare d text;marker text;begin
 d:=pg_get_functiondef('public.prepare_account_erasure(uuid,uuid,text)'::regprocedure);
 marker:='-- Personal content remains personal even if it was uploaded through a service.';
 if strpos(d,'rights_image_evidence')=0 then
  if strpos(d,marker)=0 then raise exception 'Erasure planner changed; review evidence ownership.';end if;
  execute replace(d,marker,E'insert into public.account_erasure_objects(user_id,bucket_id,object_path,disposition)\n select p_user_id,e.evidence_bucket,e.evidence_path,''purge'' from public.rights_image_evidence e where e.source_author_id=p_user_id\n on conflict(user_id,bucket_id,object_path) do update set disposition=''purge'';\n '||marker);
 end if;
end $erasure$;

-- Default function EXECUTE is PUBLIC in PostgreSQL; close every internal helper.
do $grants$ declare r record;begin
 for r in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and
 (proname like 'rights_evidence_%' or proname like '%rights_image_evidence%' or proname in('request_rights_origin_removal','guard_rights_evidence_case_lifecycle','guard_rights_evidence_case_risk','guard_rights_evidence_hold','guard_rights_evidence_immutable_history')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);
 end loop;
end $grants$;
grant execute on function public.request_rights_image_evidence(uuid,uuid,uuid,text,text,boolean),public.authorize_rights_image_evidence_read(uuid),public.get_admin_rights_image_evidence_state(uuid),public.request_rights_origin_removal(uuid,uuid,text,text) to authenticated;
grant execute on function public.claim_rights_image_evidence(text,integer),public.revalidate_rights_image_evidence(uuid,uuid),public.finish_rights_image_evidence_capture(uuid,uuid),public.finish_rights_image_evidence_removal(uuid,uuid),public.finish_rights_image_evidence_purge(uuid,uuid),public.fail_rights_image_evidence(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
