begin;

-- Private metadata review only. No catalog, installation, runtime, billing or
-- platform-admin permission is created. Provisioning is intentionally absent.
create schema market_private;
revoke all on schema market_private from public, anon, authenticated, service_role;

create table market_private.settings (
 id boolean primary key default true check(id), enabled boolean not null default false
);
insert into market_private.settings(id) values(true);
create table market_private.publishers (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid unique references public.users(id) on delete set null,
 name text not null check(char_length(name) between 1 and 100),
 active boolean not null default true, erased_at timestamptz
);
create table market_private.reviewers (
 id uuid primary key default gen_random_uuid(),
 user_id uuid unique references public.users(id) on delete set null,
 active boolean not null default true
);
create table market_private.apps (
 id uuid primary key default gen_random_uuid(),
 publisher_id uuid not null references market_private.publishers(id),
 registry_key text generated always as ('external-' || id::text) stored unique,
 draft_manifest jsonb, draft_version integer not null default 1 check(draft_version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 erased_at timestamptz,
 check((erased_at is null and draft_manifest is not null) or (erased_at is not null and draft_manifest is null))
);
create table market_private.submissions (
 id uuid primary key default gen_random_uuid(),
 app_id uuid not null references market_private.apps(id),
 draft_version integer not null check(draft_version>0),
 manifest jsonb, canonical_manifest text,
 manifest_hash text not null check(manifest_hash ~ '^[0-9a-f]{64}$'),
 canonicalization text not null default 'reylumi-manifest-pg-jsonb-v1'
  check(canonicalization='reylumi-manifest-pg-jsonb-v1'),
 submitted_by uuid references public.users(id) on delete set null,
 submitted_at timestamptz not null default now(), erased_at timestamptz,
 unique(app_id,draft_version),
 check((erased_at is null and manifest is not null and canonical_manifest is not null)
    or (erased_at is not null and manifest is null and canonical_manifest is null))
);
create table market_private.resolutions (
 submission_id uuid primary key references market_private.submissions(id),
 decision text not null check(decision in ('metadata_approved','rejected','withdrawn')),
 reason text, actor_user_id uuid references public.users(id) on delete set null,
 resolved_at timestamptz not null default now(), erased_at timestamptz,
 check(erased_at is not null or (decision='withdrawn' and reason is null)
   or (decision<>'withdrawn' and char_length(reason) between 3 and 1000))
);
create table market_private.events (
 id uuid primary key default gen_random_uuid(),
 actor_user_id uuid references public.users(id) on delete set null,
 event_type text not null check(event_type in ('draft_created','draft_saved','submitted','metadata_approved','rejected','withdrawn')),
 app_id uuid not null references market_private.apps(id),
 submission_id uuid references market_private.submissions(id),
 metadata jsonb not null default '{}' check(jsonb_typeof(metadata)='object'),
 created_at timestamptz not null default now()
);
create index registry_apps_publisher on market_private.apps(publisher_id,created_at);
create index registry_submissions_newest on market_private.submissions(submitted_at desc,id);

alter table market_private.settings enable row level security;
alter table market_private.publishers enable row level security;
alter table market_private.reviewers enable row level security;
alter table market_private.apps enable row level security;
alter table market_private.submissions enable row level security;
alter table market_private.resolutions enable row level security;
alter table market_private.events enable row level security;
revoke all on all tables in schema market_private from public,anon,authenticated,service_role;

-- Canonicalization v1: reject unknown keys, normalize all strings to NFC,
-- serialize the admitted JSONB object with PostgreSQL jsonb::text, then hash
-- its exact UTF-8 bytes with SHA-256. This is not an SDK/RFC8785 serializer.
create function market_private.validate_manifest(p_manifest jsonb) returns jsonb
language plpgsql immutable set search_path=pg_catalog,market_private as $$
declare name text; description text; version text; result jsonb;
 trim_chars text:=E' \t\n\r\f\v'||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
 if p_manifest is null or jsonb_typeof(p_manifest)<>'object' or octet_length(p_manifest::text)>16384
 or (select count(*) from jsonb_object_keys(p_manifest))<>5
 or not p_manifest ?& array['manifestSchemaVersion','appVersion','displayName','description','requestedCapabilities']
 or p_manifest->'manifestSchemaVersion'<>'1'::jsonb
 or jsonb_typeof(p_manifest->'appVersion')<>'string'
 or jsonb_typeof(p_manifest->'displayName')<>'string'
 or jsonb_typeof(p_manifest->'description')<>'string'
 or p_manifest->'requestedCapabilities'<>'[]'::jsonb then
  raise exception using errcode='22023',message='Use the supported metadata manifest with no requested capabilities.';
 end if;
 name:=normalize(btrim(p_manifest->>'displayName',trim_chars),NFC);
 description:=normalize(btrim(p_manifest->>'description',trim_chars),NFC);
 version:=normalize(btrim(p_manifest->>'appVersion',trim_chars),NFC);
 if char_length(name) not between 1 and 100 or char_length(description) not between 1 and 2000
 or char_length(version)>64
 or version !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(\.(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'
 or name ~ '[\x01-\x1F\x7F]' or description ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' then
  raise exception using errcode='22023',message='Check the app version, display name and description lengths.';
 end if;
 result:=jsonb_build_object('manifestSchemaVersion',1,'appVersion',version,'displayName',name,'description',description,'requestedCapabilities','[]'::jsonb);
 if octet_length(result::text)>16384 then raise exception using errcode='22023',message='Manifest is too large.'; end if;
 return result;
end $$;

create function market_private.require_actor() returns uuid
language plpgsql security definer set search_path=pg_catalog,market_private as $$
declare actor uuid;
begin
 perform 1 from market_private.settings where id and enabled for share;
 if not found then raise exception using errcode='42501',message='Private Market access is unavailable.'; end if;
 select u.id into actor from public.users u where u.id=public.current_public_user_id() and u.status='active' for share;
 if actor is null then raise exception using errcode='42501',message='Private Market access is unavailable.'; end if;
 return actor;
end $$;

create function market_private.submission_json(p_id uuid) returns jsonb
language sql stable set search_path=pg_catalog,market_private as $$
 select jsonb_build_object('id',s.id,'app_id',s.app_id,'draft_version',s.draft_version,
 'manifest',s.manifest,'manifest_hash',s.manifest_hash,'status',coalesce(r.decision,'submitted'),
 'submitted_at',s.submitted_at,'withdrawn_at',case when r.decision='withdrawn' then r.resolved_at end,
 'review',case when r.decision in ('metadata_approved','rejected') then
  jsonb_build_object('decision',r.decision,'reason',coalesce(r.reason,'Review reason removed after account erasure.'),'reviewed_at',r.resolved_at) else null end)
 from market_private.submissions s left join market_private.resolutions r on r.submission_id=s.id where s.id=p_id
$$;

create function public.market_registry_workspace() returns jsonb
language plpgsql security definer set search_path=pg_catalog,market_private as $$
declare actor uuid:=market_private.require_actor(); publisher market_private.publishers;
begin
 select * into publisher from market_private.publishers where owner_user_id=actor and active and erased_at is null for share;
 if publisher.id is null then raise exception using errcode='42501',message='Private developer access is unavailable.'; end if;
 return jsonb_build_object('publisher',jsonb_build_object('id',publisher.id,'name',publisher.name),
 'apps',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'registry_key',a.registry_key,
 'draft_manifest',a.draft_manifest,'draft_version',a.draft_version,'submissions',coalesce((
  select jsonb_agg(market_private.submission_json(s.id) order by s.draft_version desc)
  from market_private.submissions s where s.app_id=a.id and s.erased_at is null),'[]'::jsonb)) order by a.created_at,a.id)
  from market_private.apps a where a.publisher_id=publisher.id and a.erased_at is null),'[]'::jsonb));
end $$;

-- Domain conflicts are terminal HTTP 409 responses. Do not use 40001 here:
-- clients/transaction adapters can automatically retry serialization failures.
create function public.market_registry_save_draft(p_app_id uuid default null,p_expected_version integer default 0,p_manifest jsonb default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,market_private as $$
declare actor uuid:=market_private.require_actor(); publisher market_private.publishers; app market_private.apps; manifest jsonb; created boolean:=p_app_id is null;
begin
 select * into publisher from market_private.publishers where owner_user_id=actor and active and erased_at is null for update;
 if publisher.id is null then raise exception using errcode='42501',message='Private developer access is unavailable.'; end if;
 manifest:=market_private.validate_manifest(p_manifest);
 if p_app_id is null then
  if p_expected_version is distinct from 0 then raise exception using errcode='PT409',message='Draft changed. Reload before saving.'; end if;
  if (select count(*) from market_private.apps where publisher_id=publisher.id and erased_at is null)>=50 then raise exception using errcode='22023',message='Private app limit reached.'; end if;
  insert into market_private.apps(publisher_id,draft_manifest) values(publisher.id,manifest) returning * into app;
 else
  select * into app from market_private.apps where id=p_app_id and publisher_id=publisher.id and erased_at is null for update;
  if app.id is null then raise exception using errcode='42501',message='Private app is unavailable.'; end if;
  if app.draft_version is distinct from p_expected_version then raise exception using errcode='PT409',message='Draft changed. Reload before saving.'; end if;
  if exists(select 1 from market_private.submissions s where s.app_id=app.id and not exists(select 1 from market_private.resolutions r where r.submission_id=s.id)) then
   raise exception using errcode='PT409',message='Withdraw the pending submission before editing.';
  end if;
  update market_private.apps set draft_manifest=manifest,draft_version=draft_version+1,updated_at=now() where id=app.id returning * into app;
 end if;
 insert into market_private.events(actor_user_id,event_type,app_id,metadata)
 values(actor,case when created then 'draft_created' else 'draft_saved' end,app.id,jsonb_build_object('draft_version',app.draft_version));
 return jsonb_build_object('id',app.id,'registry_key',app.registry_key,'draft_version',app.draft_version);
end $$;

create function public.market_registry_submit(p_app_id uuid,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,market_private as $$
declare actor uuid:=market_private.require_actor(); publisher uuid; app market_private.apps; submission market_private.submissions; manifest jsonb; canonical text;
begin
 select id into publisher from market_private.publishers where owner_user_id=actor and active and erased_at is null for share;
 select * into app from market_private.apps where id=p_app_id and publisher_id=publisher and erased_at is null for update;
 if app.id is null then raise exception using errcode='42501',message='Private app is unavailable.'; end if;
 if app.draft_version is distinct from p_expected_version then raise exception using errcode='PT409',message='Draft changed. Reload before submitting.'; end if;
 select * into submission from market_private.submissions where app_id=app.id and draft_version=p_expected_version;
 if submission.id is not null then return market_private.submission_json(submission.id); end if;
 if (select count(*) from market_private.submissions where app_id=app.id)>=200 then raise exception using errcode='22023',message='Private revision limit reached.'; end if;
 if exists(select 1 from market_private.submissions s where s.app_id=app.id and not exists(select 1 from market_private.resolutions r where r.submission_id=s.id)) then
  raise exception using errcode='PT409',message='Resolve the pending submission first.';
 end if;
 manifest:=market_private.validate_manifest(app.draft_manifest); canonical:=manifest::text;
 insert into market_private.submissions(app_id,draft_version,manifest,canonical_manifest,manifest_hash,submitted_by)
 values(app.id,app.draft_version,manifest,canonical,encode(sha256(convert_to(canonical,'UTF8')),'hex'),actor) returning * into submission;
 insert into market_private.events(actor_user_id,event_type,app_id,submission_id,metadata)
 values(actor,'submitted',app.id,submission.id,jsonb_build_object('draft_version',app.draft_version,'manifest_hash',submission.manifest_hash));
 return market_private.submission_json(submission.id);
end $$;

create function public.market_registry_review_queue() returns jsonb
language plpgsql security definer set search_path=pg_catalog,market_private as $$
declare actor uuid:=market_private.require_actor();
begin
 perform 1 from market_private.reviewers where user_id=actor and active for share;
 if not found then raise exception using errcode='42501',message='Private review access is unavailable.'; end if;
 return jsonb_build_object('submissions',coalesce((select jsonb_agg(q.result order by q.submitted_at,q.id) from (
  select s.id,s.submitted_at,market_private.submission_json(s.id)||jsonb_build_object('app_registry_key',a.registry_key,'publisher_name',p.name,
   'previous_manifest',(select prior.manifest from market_private.submissions prior where prior.app_id=a.id and prior.draft_version<s.draft_version and prior.erased_at is null order by prior.draft_version desc limit 1)) result
  from market_private.submissions s join market_private.apps a on a.id=s.app_id
  join market_private.publishers p on p.id=a.publisher_id join public.users owner on owner.id=p.owner_user_id
  where s.erased_at is null and a.erased_at is null and p.erased_at is null and p.active and owner.status='active'
   and p.owner_user_id<>actor and not exists(select 1 from market_private.resolutions r where r.submission_id=s.id)
  order by s.submitted_at,s.id limit 100) q),'[]'::jsonb));
end $$;

create function public.market_registry_review(p_submission_id uuid,p_expected_version integer,p_expected_hash text,p_decision text,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,market_private as $$
declare actor uuid:=market_private.require_actor(); submission market_private.submissions; resolution market_private.resolutions; reason text; owner_id uuid;
 trim_chars text:=E' \t\n\r\f\v'||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
 perform 1 from market_private.reviewers where user_id=actor and active for share;
 if not found then raise exception using errcode='42501',message='Private review access is unavailable.'; end if;
 if p_decision is null or p_decision not in ('metadata_approved','rejected') or p_reason is null then raise exception using errcode='22023',message='Choose a metadata decision and give a reason.'; end if;
 reason:=normalize(btrim(p_reason,trim_chars),NFC);
 if char_length(reason) not between 3 and 1000 or reason ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' then raise exception using errcode='22023',message='Give a review reason between 3 and 1000 characters.'; end if;
 select p.owner_user_id into owner_id from market_private.submissions s join market_private.apps a on a.id=s.app_id join market_private.publishers p on p.id=a.publisher_id
 where s.id=p_submission_id and s.erased_at is null and a.erased_at is null and p.erased_at is null and p.active;
 if owner_id is null or owner_id=actor then raise exception using errcode='42501',message='This submission is unavailable for your review.'; end if;
 perform 1 from public.users where id=owner_id and status='active' for share;
 if not found then raise exception using errcode='42501',message='This submission is unavailable for review.'; end if;
 perform 1 from market_private.publishers p join market_private.apps a on a.publisher_id=p.id join market_private.submissions s on s.app_id=a.id
 where s.id=p_submission_id and p.owner_user_id=owner_id and p.active and p.erased_at is null for share of p;
 if not found then raise exception using errcode='42501',message='This submission is unavailable for review.'; end if;
 -- Serialize with draft editing/withdrawal, then with the immutable submission.
 perform 1 from market_private.apps a join market_private.submissions s on s.app_id=a.id where s.id=p_submission_id for update of a;
 select * into submission from market_private.submissions where id=p_submission_id and erased_at is null for update;
 if submission.id is null or submission.draft_version is distinct from p_expected_version or submission.manifest_hash is distinct from p_expected_hash then
  raise exception using errcode='PT409',message='Submission changed. Reload before reviewing.';
 end if;
 select * into resolution from market_private.resolutions where submission_id=submission.id;
 if resolution.submission_id is not null then
  if resolution.decision=p_decision and resolution.actor_user_id=actor and resolution.reason=reason then return market_private.submission_json(submission.id); end if;
  raise exception using errcode='PT409',message='This submission already has an outcome. Reload the review queue.';
 end if;
 insert into market_private.resolutions(submission_id,decision,reason,actor_user_id) values(submission.id,p_decision,reason,actor);
 insert into market_private.events(actor_user_id,event_type,app_id,submission_id,metadata)
 values(actor,p_decision,submission.app_id,submission.id,jsonb_build_object('draft_version',submission.draft_version,'manifest_hash',submission.manifest_hash));
 return market_private.submission_json(submission.id);
end $$;

create function public.market_registry_withdraw(p_submission_id uuid,p_expected_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,market_private as $$
declare actor uuid:=market_private.require_actor(); submission market_private.submissions; resolution market_private.resolutions;
begin
 perform 1 from market_private.publishers where owner_user_id=actor and active and erased_at is null for share;
 if not found then raise exception using errcode='42501',message='Private developer access is unavailable.'; end if;
 perform 1 from market_private.apps a join market_private.publishers p on p.id=a.publisher_id join market_private.submissions s on s.app_id=a.id
 where s.id=p_submission_id and p.owner_user_id=actor and p.active and p.erased_at is null and a.erased_at is null for update of a;
 if not found then raise exception using errcode='42501',message='Private submission is unavailable.'; end if;
 select * into submission from market_private.submissions where id=p_submission_id and erased_at is null for update;
 if submission.id is null or submission.manifest_hash is distinct from p_expected_hash then raise exception using errcode='PT409',message='Submission changed. Reload before withdrawing.'; end if;
 select * into resolution from market_private.resolutions where submission_id=submission.id;
 if resolution.decision='withdrawn' then return market_private.submission_json(submission.id); end if;
 if resolution.submission_id is not null then raise exception using errcode='PT409',message='This submission already has a review decision.'; end if;
 insert into market_private.resolutions(submission_id,decision,actor_user_id) values(submission.id,'withdrawn',actor);
 insert into market_private.events(actor_user_id,event_type,app_id,submission_id,metadata)
 values(actor,'withdrawn',submission.app_id,submission.id,jsonb_build_object('manifest_hash',submission.manifest_hash));
 return market_private.submission_json(submission.id);
end $$;

-- Submitted content and outcomes never change through application RPCs.
-- Only nested, private erasure triggers may replace content with tombstones;
-- FK SET NULL may clear a physically deleted actor without breaking erasure.
create function market_private.immutable_record() returns trigger
language plpgsql set search_path=pg_catalog,market_private as $$
declare before_row jsonb:=to_jsonb(old); after_row jsonb; actor_key text;
begin
 if tg_op='DELETE' then raise exception 'Registry history is append-only.'; end if;
 after_row:=to_jsonb(new);
 if pg_trigger_depth()>1 then
  if tg_table_name='submissions' and after_row->>'erased_at' is not null and after_row->'manifest'='null'::jsonb and after_row->'canonical_manifest'='null'::jsonb
   and (after_row-array['manifest','canonical_manifest','erased_at','submitted_by'])=(before_row-array['manifest','canonical_manifest','erased_at','submitted_by'])
   and (after_row->'submitted_by'='null'::jsonb or after_row->'submitted_by'=before_row->'submitted_by') then return new; end if;
  if tg_table_name='resolutions' and after_row->>'erased_at' is not null and after_row->'reason'='null'::jsonb
   and (after_row-array['reason','erased_at','actor_user_id'])=(before_row-array['reason','erased_at','actor_user_id'])
   and (after_row->'actor_user_id'='null'::jsonb or after_row->'actor_user_id'=before_row->'actor_user_id') then return new; end if;
  actor_key:=case when tg_table_name='submissions' then 'submitted_by' else 'actor_user_id' end;
  if (after_row-actor_key)=(before_row-actor_key) and after_row->actor_key='null'::jsonb then return new; end if;
 end if;
 raise exception 'Registry history is immutable.';
end $$;
create trigger registry_submission_immutable before update or delete on market_private.submissions for each row execute function market_private.immutable_record();
create trigger registry_resolution_immutable before update or delete on market_private.resolutions for each row execute function market_private.immutable_record();
create trigger registry_events_immutable before update or delete on market_private.events for each row execute function market_private.immutable_record();

create function market_private.erase_user_metadata() returns trigger
language plpgsql security definer set search_path=pg_catalog,market_private as $$
declare subject uuid:=old.id;
begin
 if tg_op='UPDATE' and (new.status is distinct from 'deleted' or old.status='deleted') then return new; end if;
 update market_private.resolutions r set reason=null,erased_at=coalesce(r.erased_at,now())
 where r.actor_user_id=subject or exists(select 1 from market_private.submissions s join market_private.apps a on a.id=s.app_id join market_private.publishers p on p.id=a.publisher_id where s.id=r.submission_id and p.owner_user_id=subject);
 update market_private.submissions s set manifest=null,canonical_manifest=null,erased_at=coalesce(s.erased_at,now())
 where exists(select 1 from market_private.apps a join market_private.publishers p on p.id=a.publisher_id where a.id=s.app_id and p.owner_user_id=subject);
 update market_private.apps a set draft_manifest=null,erased_at=coalesce(a.erased_at,now())
 where exists(select 1 from market_private.publishers p where p.id=a.publisher_id and p.owner_user_id=subject);
 update market_private.publishers set name='Deleted publisher',owner_user_id=null,active=false,erased_at=coalesce(erased_at,now()) where owner_user_id=subject;
 update market_private.reviewers set user_id=null,active=false where user_id=subject;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger market_registry_account_erasure after update of status on public.users for each row when (new.status='deleted') execute function market_private.erase_user_metadata();
create trigger market_registry_user_delete before delete on public.users for each row execute function market_private.erase_user_metadata();

revoke all on all functions in schema market_private from public,anon,authenticated,service_role;
revoke all on function public.market_registry_workspace(),public.market_registry_review_queue(),
 public.market_registry_save_draft(uuid,integer,jsonb),public.market_registry_submit(uuid,integer),
 public.market_registry_review(uuid,integer,text,text,text),public.market_registry_withdraw(uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.market_registry_workspace(),public.market_registry_review_queue(),
 public.market_registry_save_draft(uuid,integer,jsonb),public.market_registry_submit(uuid,integer),
 public.market_registry_review(uuid,integer,text,text,text),public.market_registry_withdraw(uuid,text) to authenticated;

commit;
