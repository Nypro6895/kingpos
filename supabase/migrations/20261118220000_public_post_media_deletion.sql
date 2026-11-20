-- Only explicit terminal deletion of fully pinned, newly approved post photos.
-- No legacy sweep, identity cleanup, appeal destruction or CDN recall promise.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table public.public_post_images add column if not exists public_deletion_fenced_at timestamptz,
 add column if not exists public_deleted_at timestamptz;
create table if not exists public.public_post_media_deletions(
 id uuid primary key default gen_random_uuid(), bucket text not null, object_path text not null,
 -- Deliberately no user/post FKs: enqueue runs after a post lock, while account
 -- erasure locks users first. A hidden FK user lock would invert that order.
 uploaded_by_user_id uuid not null,source_type text not null,source_id uuid not null,
 object_id uuid not null,object_version text not null check(length(object_version)>0),
 object_etag text not null check(length(object_etag)>0),sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 bytes bigint not null check(bytes between 1 and 512000),
 status text not null default 'queued' check(status in('queued','referenced','review_evidence','erasure_owned','identity_mismatch','processing','deleted')),
 created_at timestamptz not null default now(),checked_at timestamptz,
 lease_token uuid,leased_until timestamptz,attempts integer not null default 0,
 completed_at timestamptz,last_error text,unique(bucket,object_path)
);
alter table public.public_post_media_deletions enable row level security;
revoke all on public.public_post_media_deletions from public,anon,authenticated,service_role;
create index if not exists public_post_media_deletions_due on public.public_post_media_deletions(checked_at,created_at)
 where status<>'deleted';

create or replace function public.public_post_media_deletion_path(b text,p text,u uuid)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select (b='beauty-profile-media' and p ~ ('^'||u::text||'/beauty/(image|before|after)/[a-f0-9-]{36}[.]webp$'))
 or (b='salon-profile-media' and p ~ '^[a-f0-9-]{36}/(looks/[a-f0-9-]{36}/[a-f0-9-]{36}|updates/[a-f0-9-]{36})[.]webp$');
$$;

-- These helpers are VOLATILE intentionally: after obtaining the asset lock,
-- every reference scan must see commits newer than the outer RPC snapshot.
create or replace function public.public_post_media_has_reference(b text,p text)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog,public as $$
begin
 if b='beauty-profile-media' then
  return exists(select 1 from public.beauty_post_media m join public.beauty_posts x on x.id=m.post_id where m.bucket=b and m.object_path=p and x.deleted_at is null)
   or exists(select 1 from public.beauty_profiles where cover_media_path=p)
   or exists(select 1 from public.booking_inspirations where source_media_bucket=b and source_media_path=p);
 end if;
 return exists(select 1 from public.salon_profile_looks where media_path=p)
  or exists(select 1 from public.salon_profile_updates where media_path=p)
  or exists(select 1 from public.salon_settings where public_profile_cover_path=p or public_profile_logo_path=p)
  or exists(select 1 from public.staff where public_profile_photo_path=p)
  or exists(select 1 from public.booking_inspirations where source_media_bucket=b and source_media_path=p)
  or exists(select 1 from market_platform.published_groups g join public.salon_profile_media_assets a on a.salon_id=g.salon_id
   where g.group_name='media' and a.bucket=b and a.object_path=p
    and g.data @> jsonb_build_object('images',jsonb_build_array(jsonb_build_object('assetId',a.id::text))));
end $$;

create or replace function public.public_post_media_has_review(b text,p text,t text,s uuid)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog,public as $$
begin
 return exists(select 1 from public.post_safety_cases c where (c.source_type=t and c.source_id=s)
  or (b='beauty-profile-media' and c.source_type='beauty_post' and exists(select 1 from public.beauty_post_media m where m.post_id=c.source_id and m.bucket=b and m.object_path=p))
  or (b='salon-profile-media' and c.source_type in('salon_profile_look','salon_profile_update') and c.content_snapshot->>'media_path'=p));
end $$;

create or replace function public.enqueue_public_post_media_deletion(b text,p text,t text,s uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 -- Plain reads only. Never take a user/manifest/Storage lock after a post lock.
 insert into public.public_post_media_deletions(bucket,object_path,uploaded_by_user_id,source_type,source_id,object_id,object_version,object_etag,sha256,bytes)
 select i.bucket,i.object_path,i.uploaded_by_user_id,t,s,i.object_id,i.object_version,i.object_etag,i.sha256,i.bytes
 from public.public_post_images i join storage.objects o on o.bucket_id=i.bucket and o.name=i.object_path
 where i.bucket=b and i.object_path=p and i.status='approved' and i.uploaded_by_user_id is not null
  and public.public_post_media_deletion_path(b,p,i.uploaded_by_user_id)
  and i.object_id=o.id and i.object_version=o.version and i.object_etag=o.metadata->>'eTag'
  and length(i.object_version)>0 and length(i.object_etag)>0 and i.sha256 ~ '^[a-f0-9]{64}$'
  and i.sha256=o.user_metadata->>'sha256' and i.bytes between 1 and 512000
  and o.metadata->>'size'=i.bytes::text and o.metadata->>'mimetype'='image/webp'
 on conflict(bucket,object_path) do nothing;
end $$;

create or replace function public.capture_terminal_public_post_media_deletion()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare m record;
begin
 if tg_table_name='beauty_posts' then
  -- The account worker already planned these exact paths before changing posts.
  if exists(select 1 from public.account_erasure_jobs where user_id=old.author_user_id) then return new;end if;
  for m in select bucket,object_path from public.beauty_post_media where post_id=old.id order by bucket,object_path loop
   perform public.enqueue_public_post_media_deletion(m.bucket,m.object_path,'beauty_post',old.id);
  end loop;
  return new;
 end if;
 perform public.enqueue_public_post_media_deletion('salon-profile-media',old.media_path,
  case when tg_table_name='salon_profile_looks' then 'salon_profile_look' else 'salon_profile_update' end,old.id);
 return old;
end $$;
drop trigger if exists zz_capture_terminal_media on public.beauty_posts;
create trigger zz_capture_terminal_media after update of deleted_at on public.beauty_posts
 for each row when(old.deleted_at is null and new.deleted_at is not null) execute function public.capture_terminal_public_post_media_deletion();
drop trigger if exists zz_capture_terminal_media on public.salon_profile_looks;
create trigger zz_capture_terminal_media after delete on public.salon_profile_looks for each row execute function public.capture_terminal_public_post_media_deletion();
drop trigger if exists zz_capture_terminal_media on public.salon_profile_updates;
create trigger zz_capture_terminal_media after delete on public.salon_profile_updates for each row execute function public.capture_terminal_public_post_media_deletion();

create or replace function public.lock_public_post_media_reference(b text,p text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare author uuid; fenced timestamptz;
begin
 if p is null then return;end if;
 select uploaded_by_user_id into author from public.public_post_images where bucket=b and object_path=p and status<>'legacy';
 if author is null then return;end if;
 -- BEFORE UPDATE triggers may already hold a post row. Fail rather than wait
 -- behind the user-first account-erasure transaction and form a lock cycle.
 perform 1 from public.users where id=author for share nowait;
 if not found then raise exception 'Photo author is unavailable.' using errcode='42501';end if;
 select public_deletion_fenced_at into fenced from public.public_post_images where bucket=b and object_path=p for share;
 if fenced is not null then raise exception 'This deleted photo is no longer available. Choose another photo.' using errcode='42501';end if;
end $$;

create or replace function public.guard_public_post_media_reference()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare m record;
begin
 if tg_table_name='beauty_post_media' then perform public.lock_public_post_media_reference(new.bucket,new.object_path);
 elsif tg_table_name='beauty_posts' then
  if old.deleted_at is not null and new.deleted_at is null then
   for m in select bucket,object_path from public.beauty_post_media where post_id=new.id order by bucket,object_path loop
    perform public.lock_public_post_media_reference(m.bucket,m.object_path);
   end loop;
  end if;
 elsif tg_table_name='salon_profile_looks' or tg_table_name='salon_profile_updates' then perform public.lock_public_post_media_reference('salon-profile-media',new.media_path);
 elsif tg_table_name='salon_settings' then
  perform public.lock_public_post_media_reference('salon-profile-media',new.public_profile_cover_path);
  perform public.lock_public_post_media_reference('salon-profile-media',new.public_profile_logo_path);
 elsif tg_table_name='beauty_profiles' then perform public.lock_public_post_media_reference('beauty-profile-media',new.cover_media_path);
 elsif tg_table_name='staff' then perform public.lock_public_post_media_reference('salon-profile-media',new.public_profile_photo_path);
 elsif tg_table_name='booking_inspirations' then perform public.lock_public_post_media_reference(new.source_media_bucket,new.source_media_path);
 elsif tg_table_name='salon_profile_media_assets' then
  if tg_op='INSERT' then perform public.lock_public_post_media_reference(new.bucket,new.object_path);
  elsif new.bucket is distinct from old.bucket or new.object_path is distinct from old.object_path or (new.status='active' and old.status is distinct from 'active') then
   perform public.lock_public_post_media_reference(new.bucket,new.object_path);
  end if;
 elsif tg_table_schema='market_platform' and tg_table_name='published_groups' then
  if new.group_name='media' then
   for m in select a.bucket,a.object_path from public.salon_profile_media_assets a
   where a.salon_id=new.salon_id and new.data @> jsonb_build_object('images',jsonb_build_array(jsonb_build_object('assetId',a.id::text)))
   -- Keep assetId -> path stable until this group commits. Without a row
   -- SHARE lock a concurrent asset redirect could change which image the
   -- group references after we have locked the old manifest.
   order by a.bucket,a.object_path for share of a nowait loop
   perform public.lock_public_post_media_reference(m.bucket,m.object_path);
   end loop;
  end if;
 elsif tg_table_name='post_safety_cases' then
  if new.source_type='beauty_post' then
   for m in select bucket,object_path from public.beauty_post_media where post_id=new.source_id order by bucket,object_path loop
    perform public.lock_public_post_media_reference(m.bucket,m.object_path);
   end loop;
  elsif new.source_type in('salon_profile_look','salon_profile_update') then
   perform public.lock_public_post_media_reference('salon-profile-media',new.content_snapshot->>'media_path');
  end if;
 end if;
 return new;
end $$;
do $$ declare t text;begin
 foreach t in array array['beauty_post_media','beauty_posts','salon_profile_looks','salon_profile_updates','salon_settings','beauty_profiles','staff','booking_inspirations','post_safety_cases','salon_profile_media_assets'] loop
  execute format('drop trigger if exists aa_public_media_reference on public.%I',t);
  execute format('create trigger aa_public_media_reference before insert or update on public.%I for each row execute function public.guard_public_post_media_reference()',t);
 end loop;
end $$;
drop trigger if exists aa_public_media_reference on market_platform.published_groups;
create trigger aa_public_media_reference before insert or update on market_platform.published_groups
 for each row execute function public.guard_public_post_media_reference();

create or replace function public.guard_public_post_media_deletion_storage()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare b text; p text; author uuid; fenced timestamptz;
begin
 b:=case when tg_op='DELETE' then old.bucket_id else new.bucket_id end;
 p:=case when tg_op='DELETE' then old.name else new.name end;
 if tg_op='DELETE' then
  select uploaded_by_user_id,public_deletion_fenced_at into author,fenced from public.public_post_images where bucket=b and object_path=p;
  if fenced is not null then
   -- The erasure planner owns the user lock. Recheck its retention tasks under
   -- that same lock during the actual Storage transaction, not only at claim.
   perform 1 from public.users where id=author for share nowait;
   perform 1 from public.public_post_images where bucket=b and object_path=p for share nowait;
   if exists(select 1 from public.account_erasure_objects where bucket_id=b and object_path=p and disposition='retain_business') then
    raise exception 'Photo is retained for business erasure.' using errcode='42501';
   end if;
  end if;
  return old;
 end if;
 -- Do not change the existing, separately guarded leased same-path retention
 -- COPY exception. The original Storage trigger still validates all its gates.
 if storage.allow_only_operation('object.copy') and exists(select 1 from public.account_erasure_objects where bucket_id=b and object_path=p and disposition='retain_business' and completed_at is null) then return new;end if;
 if tg_op='UPDATE' then perform public.lock_public_post_media_reference(old.bucket_id,old.name);end if;
 perform public.lock_public_post_media_reference(b,p);
 return new;
end $$;
drop trigger if exists aa_public_media_deletion_storage on storage.objects;
create trigger aa_public_media_deletion_storage before insert or update or delete on storage.objects
 for each row execute function public.guard_public_post_media_deletion_storage();

create or replace function public.claim_public_post_media_deletions(p_limit integer default 5)
returns setof public.public_post_media_deletions language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare candidate record; item public.public_post_images; job public.public_post_media_deletions; reason text; author_status text; n integer:=0;
begin
 if coalesce(nullif(current_setting('request.jwt.claim.role',true),''),coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role','')<>'service_role' then raise exception 'Service role required.' using errcode='42501';end if;
 for candidate in select q.id,q.uploaded_by_user_id,q.bucket,q.object_path from public.public_post_media_deletions q
  where q.status<>'deleted' and (q.leased_until is null or q.leased_until<=clock_timestamp())
   and (q.checked_at is null or q.checked_at<=clock_timestamp()-interval '5 minutes')
   -- Account erasure may already have consumed a manifest. Such stale queue
   -- receipts must not permanently occupy the bounded candidate window.
   and exists(select 1 from public.public_post_images i where i.bucket=q.bucket and i.object_path=q.object_path)
  order by q.checked_at nulls first,q.created_at,q.id limit 40 loop
  -- Global order: user -> manifest -> queue. Never lock a source post or the
  -- Storage row. SKIP LOCKED also bounds work during concurrent publication.
  select status into author_status from public.users where id=candidate.uploaded_by_user_id for share skip locked;
  if not found then continue;end if;
  select * into item from public.public_post_images where bucket=candidate.bucket and object_path=candidate.object_path for update skip locked;
  if not found then continue;end if;
  select * into job from public.public_post_media_deletions where id=candidate.id for update skip locked;
  if not found or job.status='deleted' or job.leased_until>clock_timestamp() then continue;end if;
  reason:=null;
  if author_status<>'active' or exists(select 1 from public.account_erasure_objects where bucket_id=job.bucket and object_path=job.object_path and (disposition='retain_business' or completed_at is null)) then reason:='erasure_owned';
  elsif public.public_post_media_has_review(job.bucket,job.object_path,job.source_type,job.source_id) then reason:='review_evidence';
  elsif public.public_post_media_has_reference(job.bucket,job.object_path) then reason:='referenced';
  elsif item.status<>'approved' or item.uploaded_by_user_id is distinct from job.uploaded_by_user_id
   or item.object_id is distinct from job.object_id or item.object_version is distinct from job.object_version
   or item.object_etag is distinct from job.object_etag or item.sha256 is distinct from job.sha256 or item.bytes is distinct from job.bytes
   or not exists(select 1 from storage.objects o where o.bucket_id=job.bucket and o.name=job.object_path
    and o.id=job.object_id and o.version=job.object_version and o.metadata->>'eTag'=job.object_etag
    and o.user_metadata->>'sha256'=job.sha256 and o.metadata->>'size'=job.bytes::text and o.metadata->>'mimetype'='image/webp')
    and exists(select 1 from storage.objects where bucket_id=job.bucket and name=job.object_path) then reason:='identity_mismatch';
  end if;
  if reason is not null then
   update public.public_post_media_deletions set status=reason,checked_at=clock_timestamp(),lease_token=null,leased_until=null where id=job.id;
   continue;
  end if;
  update public.public_post_images set public_deletion_fenced_at=coalesce(public_deletion_fenced_at,clock_timestamp()) where bucket=job.bucket and object_path=job.object_path;
  update public.public_post_media_deletions set status='processing',checked_at=clock_timestamp(),attempts=attempts+1,
   lease_token=gen_random_uuid(),leased_until=clock_timestamp()+interval '2 minutes',last_error=null where id=job.id returning * into job;
  return next job;n:=n+1;
  exit when n>=greatest(1,least(coalesce(p_limit,5),5));
 end loop;
end $$;

create or replace function public.finish_public_post_media_deletion(p_id uuid,p_lease uuid,p_error text default null)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare candidate public.public_post_media_deletions; job public.public_post_media_deletions;
begin
 if coalesce(nullif(current_setting('request.jwt.claim.role',true),''),coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role','')<>'service_role' then raise exception 'Service role required.' using errcode='42501';end if;
 if p_error is not null and p_error not in('storage_remove_failed','time_budget') then raise exception 'Invalid cleanup result.';end if;
 select * into candidate from public.public_post_media_deletions where id=p_id;
 if not found then return false;end if;
 perform 1 from public.users where id=candidate.uploaded_by_user_id for share nowait;
 perform 1 from public.public_post_images where bucket=candidate.bucket and object_path=candidate.object_path for update nowait;
 select * into job from public.public_post_media_deletions where id=p_id for update nowait;
 if job.status='deleted' then return job.lease_token=p_lease;end if;
 if job.status<>'processing' or job.lease_token is distinct from p_lease or job.leased_until<=clock_timestamp() then return false;end if;
 if p_error is not null then
  update public.public_post_media_deletions set status='queued',leased_until=null,lease_token=null,checked_at=clock_timestamp(),last_error=p_error where id=p_id;
  return false;
 end if;
 if exists(select 1 from storage.objects where bucket_id=job.bucket and name=job.object_path) then return false;end if;
 -- Asset writers can already own their row before taking the manifest SHARE
 -- lock. Never wait back on that row while holding manifest UPDATE.
 perform 1 from public.salon_profile_media_assets where bucket=job.bucket and object_path=job.object_path for update nowait;
 update public.public_post_media_deletions set status='deleted',completed_at=clock_timestamp(),leased_until=null,last_error=null where id=p_id;
 update public.public_post_images set public_deleted_at=coalesce(public_deleted_at,clock_timestamp()) where bucket=job.bucket and object_path=job.object_path and public_deletion_fenced_at is not null;
 update public.salon_profile_media_assets set status='deleted',deleted_at=coalesce(deleted_at,clock_timestamp()) where bucket=job.bucket and object_path=job.object_path;
 return true;
exception when lock_not_available then return false;
end $$;

do $$ declare f regprocedure;begin
 foreach f in array array[
 'public.public_post_media_deletion_path(text,text,uuid)'::regprocedure,
 'public.public_post_media_has_reference(text,text)'::regprocedure,
 'public.public_post_media_has_review(text,text,text,uuid)'::regprocedure,
 'public.enqueue_public_post_media_deletion(text,text,text,uuid)'::regprocedure,
 'public.capture_terminal_public_post_media_deletion()'::regprocedure,
 'public.lock_public_post_media_reference(text,text)'::regprocedure,
 'public.guard_public_post_media_reference()'::regprocedure,
 'public.guard_public_post_media_deletion_storage()'::regprocedure,
 'public.claim_public_post_media_deletions(integer)'::regprocedure,
 'public.finish_public_post_media_deletion(uuid,uuid,text)'::regprocedure] loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
 end loop;
end $$;
grant execute on function public.claim_public_post_media_deletions(integer),public.finish_public_post_media_deletion(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
