begin;

-- New post images are private until a trusted automated verifier has examined
-- the exact normalized bytes. Identity covers/avatars are outside this change.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('public-image-quarantine','public-image-quarantine',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create table if not exists public.public_post_images(
 bucket text not null check(bucket in ('beauty-profile-media','salon-profile-media')),
 object_path text not null,
 quarantine_path text not null unique,
 uploaded_by_user_id uuid references public.users(id),
 salon_id uuid references public.locations(id),
 purpose text not null check(purpose in ('image','before','after','look','update')),
 status text not null default 'staged' check(status in ('staged','approved','rejected','cancelled','legacy')),
 sha256 text check(sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
 width integer,height integer,bytes bigint,
 provider text,model text,policy_version text,
 object_id uuid,object_version text,object_etag text,
 created_at timestamptz not null default now(),approved_at timestamptz,
 private_removed_at timestamptz,cleanup_claimed_until timestamptz,
 primary key(bucket,object_path),
 check(quarantine_path=bucket||'/'||object_path)
);
alter table public.public_post_images add column if not exists private_removed_at timestamptz,
 add column if not exists cleanup_claimed_until timestamptz;
create index if not exists public_post_images_staging_expiry on public.public_post_images(created_at)
 where private_removed_at is null and status in ('staged','cancelled','rejected','approved');
alter table public.public_post_images enable row level security;
revoke all on public.public_post_images from public,anon,authenticated;
grant select on public.public_post_images to authenticated,service_role;
grant update on public.public_post_images to service_role;
drop policy if exists public_post_images_own_read on public.public_post_images;
create policy public_post_images_own_read on public.public_post_images for select to authenticated
 using(uploaded_by_user_id=public.current_public_user_id());

-- Freeze only exact pre-existing published references. This is not a time-based
-- exemption for future uploads or unreferenced objects in a public bucket.
create table if not exists public.public_image_safety_installation(id boolean primary key default true check(id),installed_at timestamptz not null default now());
revoke all on public.public_image_safety_installation from public,anon,authenticated,service_role;
do $legacy$
begin
if not exists(select 1 from public.public_image_safety_installation where id) then
insert into public.public_post_images(bucket,object_path,quarantine_path,uploaded_by_user_id,salon_id,purpose,status,object_id,object_version,object_etag)
select distinct on (m.bucket,m.object_path) m.bucket,m.object_path,m.bucket||'/'||m.object_path,p.author_user_id,null,m.role,'legacy',o.id,o.version,o.metadata->>'eTag'
from public.beauty_post_media m join public.beauty_posts p on p.id=m.post_id
join public.beauty_profiles b on b.id=p.profile_id join storage.objects o on o.bucket_id=m.bucket and o.name=m.object_path
where p.deleted_at is null and p.visibility='public' and p.moderation_status='visible' and b.visibility='public'
on conflict(bucket,object_path) do nothing;
insert into public.public_post_images(bucket,object_path,quarantine_path,uploaded_by_user_id,salon_id,purpose,status,object_id,object_version,object_etag)
select 'salon-profile-media',p.media_path,'salon-profile-media/'||p.media_path,coalesce(p.author_user_id,p.created_by_user_id),p.salon_id,'look','legacy',o.id,o.version,o.metadata->>'eTag'
from public.salon_profile_looks p join storage.objects o on o.bucket_id='salon-profile-media' and o.name=p.media_path
where p.status='published' and not p.safety_hold
on conflict(bucket,object_path) do nothing;

insert into public.public_post_images(bucket,object_path,quarantine_path,uploaded_by_user_id,salon_id,purpose,status,object_id,object_version,object_etag)
select 'salon-profile-media',p.media_path,'salon-profile-media/'||p.media_path,coalesce(p.author_user_id,p.created_by_user_id),p.salon_id,'update','legacy',o.id,o.version,o.metadata->>'eTag'
from public.salon_profile_updates p join storage.objects o on o.bucket_id='salon-profile-media' and o.name=p.media_path
where p.status='published' and not p.safety_hold
on conflict(bucket,object_path) do nothing;

insert into public.public_image_safety_installation(id) values(true);
end if;
end $legacy$;

create or replace function public.reserve_public_post_image(p_bucket text,p_path text,p_purpose text,p_salon_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.current_public_user_id(); item public.public_post_images;
 nonce text:='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
begin
 if actor is null or not exists(select 1 from public.users where id=actor and status='active' for share) then raise exception 'Sign in to an active account.';end if;
 if p_bucket='beauty-profile-media' then
  if p_salon_id is not null or p_purpose not in ('image','before','after')
  or p_path !~ ('^'||actor::text||'/beauty/'||p_purpose||'/'||nonce||'[.]webp$') then raise exception 'Invalid Beauty post image.';end if;
 elsif p_bucket='salon-profile-media' then
  if p_salon_id is null or p_purpose not in ('look','update')
  or not (public.current_user_can_post_salon_content(p_salon_id) or public.user_has_salon_permission(p_salon_id,array['salon_profile.manage','salon_profile.content.manage']))
  or (p_purpose='look' and p_path !~ ('^'||p_salon_id::text||'/looks/'||nonce||'/'||nonce||'[.]webp$'))
  or (p_purpose='update' and p_path !~ ('^'||p_salon_id::text||'/updates/'||nonce||'[.]webp$')) then raise exception 'Invalid salon post image or permission.';end if;
 else raise exception 'Invalid public post image bucket.';end if;
 select * into item from public.public_post_images where bucket=p_bucket and object_path=p_path for update;
 if found then
  if item.uploaded_by_user_id is distinct from actor or item.salon_id is distinct from p_salon_id or item.purpose<>p_purpose or item.status<>'staged' then raise exception 'Post image path is already reserved.';end if;
  return to_jsonb(item);
 end if;
 if exists(select 1 from storage.objects where bucket_id=p_bucket and name=p_path) then raise exception 'Post image path already exists.';end if;
 insert into public.public_post_images(bucket,object_path,quarantine_path,uploaded_by_user_id,salon_id,purpose)
 values(p_bucket,p_path,p_bucket||'/'||p_path,actor,p_salon_id,p_purpose) returning * into item;
 return to_jsonb(item);
end $$;
revoke all on function public.reserve_public_post_image(text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.reserve_public_post_image(text,text,text,uuid) to authenticated;

create or replace function public.public_post_image_is_protected(p_bucket text,p_path text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select (p_bucket='beauty-profile-media' and p_path ~ '^[^/]+/beauty/(image|before|after)/')
 or (p_bucket='salon-profile-media' and p_path ~ '^[^/]+/(looks|updates)/')
 or exists(select 1 from public.public_post_images where bucket=p_bucket and object_path=p_path);
$$;
revoke all on function public.public_post_image_is_protected(text,text) from public,anon,authenticated;
grant execute on function public.public_post_image_is_protected(text,text) to anon,authenticated,service_role;

-- Restrictive policies beat older broad manager/owner policies. Existing
-- identity image writes and every financial/private bucket keep their rules.
drop policy if exists post_image_no_client_public_insert on storage.objects;
create policy post_image_no_client_public_insert on storage.objects as restrictive for insert to authenticated
 with check(not public.public_post_image_is_protected(bucket_id,name));
drop policy if exists post_image_no_client_public_update on storage.objects;
create policy post_image_no_client_public_update on storage.objects as restrictive for update to authenticated
 using(not public.public_post_image_is_protected(bucket_id,name)) with check(not public.public_post_image_is_protected(bucket_id,name));
drop policy if exists post_image_no_client_public_delete on storage.objects;
create policy post_image_no_client_public_delete on storage.objects as restrictive for delete to authenticated
 using(not public.public_post_image_is_protected(bucket_id,name));

-- Storage signed-upload routes can bypass ordinary RLS after token issuance.
-- That route internally uses service_role, so JWT role alone is insufficient.
-- Reject its operation context even for service_role. Ordinary trusted service
-- upload/copy/delete and explicit direct admin sessions can run maintenance.
create or replace function public.guard_public_post_image_storage()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare b text; p text; claims jsonb; trusted boolean; quarantine boolean; author uuid; item public.public_post_images;
begin
 b:=case when tg_op='DELETE' then old.bucket_id else new.bucket_id end;
 p:=case when tg_op='DELETE' then old.name else new.name end;
 quarantine:=b='public-image-quarantine' or (tg_op='UPDATE' and old.bucket_id='public-image-quarantine');
 if not public.public_post_image_is_protected(b,p)
 and (tg_op<>'UPDATE' or not public.public_post_image_is_protected(old.bucket_id,old.name)) and not quarantine then
  return case when tg_op='DELETE' then old else new end;
 end if;
 -- SECURITY DEFINER is needed for row locks without granting manifest UPDATE
 -- to clients. Only a real direct admin session, never the definer identity,
 -- is exempt for explicit database maintenance.
 if session_user in ('postgres','supabase_admin') and current_setting('role',true) in ('none','postgres','supabase_admin') then
  return case when tg_op='DELETE' then old else new end;
 end if;
 claims:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
 trusted:=coalesce(claims->>'role',nullif(current_setting('request.jwt.claim.role',true),''),'')='service_role';
 if (not quarantine and not trusted) or storage.allow_any_operation(array['object.upload_signed']) then
  raise exception 'Post image bytes are immutable to clients.' using errcode='42501';
 end if;
 if tg_op='DELETE' then return old;end if;
 -- The shipped erasure worker retains legitimate historical business files by
 -- copying the same bytes/path to detach Auth ownership. This exception needs
 -- an active leased retain_business task and an existing matching object. It
 -- cannot recreate a missing file, change its bytes or authorize client copies.
 if trusted and not quarantine and storage.allow_only_operation('object.copy')
  and exists(select 1 from public.account_erasure_objects e
   join public.account_erasure_jobs j on j.user_id=e.user_id
   join public.users u on u.id=e.user_id
   where e.bucket_id=b and e.object_path=p and e.disposition='retain_business' and e.completed_at is null
    and j.status='processing' and j.leased_until>now() and u.status in ('pending_deletion','deleted'))
  and exists(select 1 from storage.objects o where o.bucket_id=b and o.name=p
   and o.metadata->>'eTag' is not null and o.metadata->>'eTag'=new.metadata->>'eTag'
   and o.metadata->>'size'=new.metadata->>'size' and o.metadata->>'mimetype'=new.metadata->>'mimetype') then
  return new;
 end if;
 -- Storage may finish a long upload after a deletion worker already purged its
 -- path. Fence the metadata commit with the same user lock as erasure planning.
 select uploaded_by_user_id into author from public.public_post_images
 where (not quarantine and bucket=b and object_path=p) or (quarantine and quarantine_path=p);
 if author is null or (quarantine and not trusted and author is distinct from public.current_public_user_id())
  or not exists(select 1 from public.users where id=author and status='active' for share) then
  raise exception 'Post image author is unavailable.' using errcode='42501';
 end if;
 select * into item from public.public_post_images
 where (not quarantine and bucket=b and object_path=p) or (quarantine and quarantine_path=p) for share;
 if item.object_path is null or item.uploaded_by_user_id is distinct from author
  or (quarantine and item.status<>'staged') or (not quarantine and item.status not in ('staged','approved','legacy')) then
  raise exception 'Post image reservation is unavailable.' using errcode='42501';
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.guard_public_post_image_storage() from public,anon,authenticated;
drop trigger if exists guard_public_post_image_storage on storage.objects;
create trigger guard_public_post_image_storage before insert or update or delete on storage.objects
 for each row execute function public.guard_public_post_image_storage();

drop policy if exists post_image_quarantine_insert on storage.objects;
create policy post_image_quarantine_insert on storage.objects for insert to authenticated with check(
 bucket_id='public-image-quarantine' and storage.allow_only_operation('object.upload')
 and exists(select 1 from public.public_post_images i where i.quarantine_path=name and i.uploaded_by_user_id=public.current_public_user_id() and i.status='staged')
);
drop policy if exists post_image_quarantine_read on storage.objects;
create policy post_image_quarantine_read on storage.objects for select to authenticated using(
 bucket_id='public-image-quarantine'
 and storage.allow_any_operation(array['object.get_authenticated','object.get_authenticated_info','object.head_authenticated_info','object.list','object.list_v2'])
 and exists(select 1 from public.public_post_images i where i.quarantine_path=name and i.uploaded_by_user_id=public.current_public_user_id())
);
drop policy if exists post_image_quarantine_read_gate on storage.objects;
create policy post_image_quarantine_read_gate on storage.objects as restrictive for select to anon,authenticated using(
 bucket_id<>'public-image-quarantine' or (storage.allow_any_operation(array['object.get_authenticated','object.get_authenticated_info','object.head_authenticated_info','object.list','object.list_v2'])
 and exists(select 1 from public.public_post_images i where i.quarantine_path=name and i.uploaded_by_user_id=public.current_public_user_id()))
);
drop policy if exists post_image_quarantine_insert_gate on storage.objects;
create policy post_image_quarantine_insert_gate on storage.objects as restrictive for insert to authenticated with check(
 bucket_id<>'public-image-quarantine' or (storage.allow_only_operation('object.upload')
 and exists(select 1 from public.public_post_images i where i.quarantine_path=name and i.uploaded_by_user_id=public.current_public_user_id() and i.status='staged'))
);
drop policy if exists post_image_quarantine_no_update on storage.objects;
create policy post_image_quarantine_no_update on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'public-image-quarantine') with check(bucket_id<>'public-image-quarantine');
drop policy if exists post_image_quarantine_no_delete on storage.objects;
create policy post_image_quarantine_no_delete on storage.objects as restrictive for delete to authenticated using(bucket_id<>'public-image-quarantine');

create or replace function public.finish_public_post_image(p_bucket text,p_path text,p_sha256 text,p_width integer,p_height integer,p_bytes bigint,p_provider text,p_model text,p_policy_version text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare item public.public_post_images; object storage.objects; author uuid;
begin
 select uploaded_by_user_id into author from public.public_post_images where bucket=p_bucket and object_path=p_path;
 if author is null or not exists(select 1 from public.users where id=author and status='active' for share) then raise exception 'Post image author is unavailable.';end if;
 select * into item from public.public_post_images where bucket=p_bucket and object_path=p_path for update;
 if item.object_path is null or item.uploaded_by_user_id is distinct from author or item.status not in ('staged','approved') then raise exception 'Post image reservation is unavailable.';end if;
 if coalesce(p_sha256,'') !~ '^[a-f0-9]{64}$' or coalesce(p_width,0) not between 1 and 1600 or coalesce(p_height,0) not between 1 and 1600 or coalesce(p_bytes,0) not between 1 and 512000
 or coalesce(length(p_provider),0) not between 1 and 120 or coalesce(length(p_model),0) not between 1 and 160 or coalesce(length(p_policy_version),0) not between 1 and 120 then raise exception 'Invalid image safety approval.';end if;
 select * into object from storage.objects where bucket_id=p_bucket and name=p_path for share;
 if object.id is null or object.user_metadata->>'sha256' is distinct from p_sha256
 or object.metadata->>'mimetype' is distinct from 'image/webp'
 or (object.metadata->>'size')::bigint is distinct from p_bytes then raise exception 'Approved image bytes do not match Storage.';end if;
 if item.status='approved' then
  if item.sha256 is distinct from p_sha256 or item.object_id is distinct from object.id or item.object_version is distinct from object.version or item.object_etag is distinct from object.metadata->>'eTag' then raise exception 'Approved image path collision.';end if;
  return to_jsonb(item);
 end if;
 update public.public_post_images set status='approved',sha256=p_sha256,width=p_width,height=p_height,bytes=p_bytes,
 provider=p_provider,model=p_model,policy_version=p_policy_version,object_id=object.id,object_version=object.version,object_etag=object.metadata->>'eTag',approved_at=now()
 where bucket=p_bucket and object_path=p_path returning * into item;
 return to_jsonb(item);
end $$;
revoke all on function public.finish_public_post_image(text,text,text,integer,integer,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.finish_public_post_image(text,text,text,integer,integer,bigint,text,text,text) to service_role;

create or replace function public.cancel_public_post_image(p_bucket text,p_path text,p_user_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare item public.public_post_images;
begin
 select * into item from public.public_post_images where bucket=p_bucket and object_path=p_path for update;
 if item.object_path is null or item.uploaded_by_user_id is distinct from p_user_id then return false;end if;
 if item.status='cancelled' then return true;end if;
 if item.status<>'staged' then return false;end if;
 update public.public_post_images set status='cancelled' where bucket=p_bucket and object_path=p_path;
 return true;
end $$;
revoke all on function public.cancel_public_post_image(text,text,uuid) from public,anon,authenticated;
grant execute on function public.cancel_public_post_image(text,text,uuid) to service_role;

-- Reuse authenticated maintenance for private staging only. A seven-day-old
-- pending reservation is fenced before removal, so late uploads/approval fail.
-- Approved public copies stay approved; only their redundant private source is
-- eligible. A short lease bounds duplicate work without trusting a client.
create or replace function public.claim_expired_public_image_staging(p_limit integer default 10)
returns setof public.public_post_images language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 return query with due as (
  select bucket,object_path from public.public_post_images
  where status in ('staged','cancelled','rejected','approved') and private_removed_at is null
   and created_at<=now()-interval '7 days'
   and (cleanup_claimed_until is null or cleanup_claimed_until<=now())
  order by created_at,bucket,object_path limit greatest(1,least(coalesce(p_limit,10),10)) for update skip locked
 ) update public.public_post_images i
 set status=case when i.status='staged' then 'cancelled' else i.status end,
  cleanup_claimed_until=now()+interval '5 minutes'
 from due where i.bucket=due.bucket and i.object_path=due.object_path returning i.*;
end $$;
revoke all on function public.claim_expired_public_image_staging(integer) from public,anon,authenticated;
grant execute on function public.claim_expired_public_image_staging(integer) to service_role;

create or replace function public.finish_public_image_staging_expiry(p_bucket text,p_path text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare item public.public_post_images;
begin
 select * into item from public.public_post_images where bucket=p_bucket and object_path=p_path for update;
 if item.object_path is null or item.status not in ('cancelled','rejected','approved')
  or item.created_at>now()-interval '7 days' then return false;end if;
 if exists(select 1 from storage.objects where bucket_id='public-image-quarantine' and name=item.quarantine_path) then return false;end if;
 if item.private_removed_at is not null then return true;end if;
 update public.public_post_images set private_removed_at=now(),cleanup_claimed_until=null
 where bucket=p_bucket and object_path=p_path;
 return true;
end $$;
revoke all on function public.finish_public_image_staging_expiry(text,text) from public,anon,authenticated;
grant execute on function public.finish_public_image_staging_expiry(text,text) to service_role;

create or replace function public.public_post_image_is_approved(p_bucket text,p_path text,p_purpose text,p_author uuid,p_salon uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.public_post_images i join storage.objects o on o.bucket_id=i.bucket and o.name=i.object_path
 where i.bucket=p_bucket and i.object_path=p_path and i.purpose=p_purpose
 and i.salon_id is not distinct from p_salon
 and (p_salon is not null or i.uploaded_by_user_id=p_author)
 and i.status in ('approved','legacy') and i.object_id=o.id and i.object_version is not distinct from o.version and i.object_etag is not distinct from o.metadata->>'eTag'
 and (i.status='legacy' or (i.sha256=o.user_metadata->>'sha256' and (o.metadata->>'size')::bigint=i.bytes and o.metadata->>'mimetype'='image/webp')));
$$;
revoke all on function public.public_post_image_is_approved(text,text,text,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.guard_post_image_publication()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare author uuid; purpose text;
begin
 if tg_table_name='beauty_post_media' then
  if tg_op='UPDATE' and new.object_path is not distinct from old.object_path and new.bucket=old.bucket and new.role=old.role and new.post_id=old.post_id then return new;end if;
  select author_user_id into author from public.beauty_posts where id=new.post_id;
  if not public.public_post_image_is_approved(new.bucket,new.object_path,new.role,author,null) then raise exception 'Post image safety approval required.' using errcode='42501';end if;
 else
  if new.status<>'published' or new.media_path is null then return new;end if;
  if tg_op='UPDATE' and new.status=old.status and new.media_path is not distinct from old.media_path then return new;end if;
  purpose:=case when tg_table_name='salon_profile_looks' then 'look' else 'update' end;
  if not public.public_post_image_is_approved('salon-profile-media',new.media_path,purpose,coalesce(new.author_user_id,new.created_by_user_id),new.salon_id) then raise exception 'Post image safety approval required.' using errcode='42501';end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_post_image_publication() from public,anon,authenticated;
drop trigger if exists ac_post_image_approval on public.beauty_post_media;
create trigger ac_post_image_approval before insert or update on public.beauty_post_media for each row execute function public.guard_post_image_publication();
drop trigger if exists ac_post_image_approval on public.salon_profile_looks;
create trigger ac_post_image_approval before insert or update on public.salon_profile_looks for each row execute function public.guard_post_image_publication();
drop trigger if exists ac_post_image_approval on public.salon_profile_updates;
create trigger ac_post_image_approval before insert or update on public.salon_profile_updates for each row execute function public.guard_post_image_publication();

create table if not exists public.beauty_post_submission_requests(
 user_id uuid not null references public.users(id),request_id uuid not null,input_sha256 text not null,result jsonb not null,created_at timestamptz not null default now(),primary key(user_id,request_id)
);
alter table public.beauty_post_submission_requests enable row level security;
revoke all on public.beauty_post_submission_requests from public,anon,authenticated;
grant select on public.beauty_post_submission_requests to service_role;
create or replace function public.lookup_beauty_post_submission(p_request_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.current_public_user_id(); fingerprint text; saved public.beauty_post_submission_requests;
begin
 if actor is null or p_request_id is null or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Invalid post submission.';end if;
 fingerprint:=encode(sha256(convert_to(p_input::text,'UTF8')),'hex');
 select * into saved from public.beauty_post_submission_requests where user_id=actor and request_id=p_request_id;
 if not found then return null;end if;
 if saved.input_sha256<>fingerprint then raise exception 'Post submission was reused with different content.';end if;
 if not exists(select 1 from public.beauty_posts where id=(saved.result->>'postId')::uuid and author_user_id=actor and deleted_at is null and moderation_status='visible' and visibility='public' and not safety_hold) then raise exception 'This post was already processed and is no longer published. Refresh your feed.';end if;
 return saved.result;
end $$;
revoke all on function public.lookup_beauty_post_submission(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.lookup_beauty_post_submission(uuid,jsonb) to authenticated;

-- The separate request packet is frozen raw intent. Normalization can change
-- transport metadata without changing the identity of an already-saved draft.
drop function if exists public.create_beauty_post_once(uuid,jsonb);
create or replace function public.create_beauty_post_once(p_request_id uuid,p_input jsonb,p_request_input jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.current_public_user_id(); fingerprint text; saved public.beauty_post_submission_requests; result jsonb;
begin
 if actor is null or p_request_id is null or jsonb_typeof(p_input) is distinct from 'object' or jsonb_typeof(coalesce(p_request_input,p_input)) is distinct from 'object' then raise exception 'Invalid post submission.';end if;
 fingerprint:=encode(sha256(convert_to(coalesce(p_request_input,p_input)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('beauty-post:'||actor::text||':'||p_request_id::text,0));
 select * into saved from public.beauty_post_submission_requests where user_id=actor and request_id=p_request_id;
 if found then
  if saved.input_sha256<>fingerprint then raise exception 'Post submission was reused with different content.';end if;
  if not exists(select 1 from public.beauty_posts where id=(saved.result->>'postId')::uuid and author_user_id=actor and deleted_at is null and moderation_status='visible' and visibility='public' and not safety_hold) then raise exception 'This post was already processed and is no longer published. Refresh your feed.';end if;
  return saved.result;
 end if;
 if not exists(select 1 from public.users where id=actor and status='active') then raise exception 'Sign in to an active account.';end if;
 result:=public.create_beauty_post(coalesce(p_input->>'postType','regular'),p_input->>'caption','public',coalesce(p_input->'media','[]'),nullif(p_input->>'salonId','')::uuid,nullif(p_input->>'staffId','')::uuid,coalesce(p_input->>'attributionSource','customer_claimed'));
 if result->>'ok'='true' then
  if not exists(select 1 from public.beauty_posts where id=(result->>'postId')::uuid and author_user_id=actor and deleted_at is null and moderation_status='visible' and visibility='public' and not safety_hold) then
   raise exception 'Post could not be published under current posting restrictions.';
  end if;
  insert into public.beauty_post_submission_requests(user_id,request_id,input_sha256,result) values(actor,p_request_id,fingerprint,result);
 end if;
 return result;
end $$;
revoke all on function public.create_beauty_post_once(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.create_beauty_post_once(uuid,jsonb,jsonb) to authenticated;

-- New service-promoted files may precede post attachment. Include exact new
-- pipeline paths. Frozen legacy registrations do not reclassify historical
-- business media; the original planner still classifies those authored files.
do $patch$
declare definition text; marker text;
begin
 definition:=pg_get_functiondef('public.prepare_account_erasure(uuid,uuid,text)'::regprocedure);
 marker:='-- Personal content remains personal even if it was uploaded through a service.';
 if strpos(definition,'public.public_post_images')=0 then
  if strpos(definition,marker)=0 then raise exception 'Account erasure planner changed; review public image integration.';end if;
  execute replace(definition,marker,E'insert into account_erasure_objects(user_id,bucket_id,object_path,disposition)\n select p_user_id,files.bucket,files.path,''purge'' from (\n select ''public-image-quarantine''::text bucket,quarantine_path path from public.public_post_images where uploaded_by_user_id=p_user_id and status<>''legacy''\n union select bucket,object_path from public.public_post_images where uploaded_by_user_id=p_user_id and status<>''legacy''\n ) files on conflict(user_id,bucket_id,object_path) do update set disposition=''purge'';\n '||marker);
 end if;
 definition:=pg_get_functiondef('public.erase_account_personal_content(uuid,uuid)'::regprocedure);
 marker:='perform public.erase_tax_personal_profile(p_user_id);';
 if strpos(definition,'beauty_post_submission_requests')=0 then
  if strpos(definition,marker)=0 then raise exception 'Account personal erasure changed; review public image integration.';end if;
  execute replace(definition,marker,marker||E'\n delete from public.beauty_post_submission_requests where user_id=p_user_id;\n delete from public.public_post_images where uploaded_by_user_id=p_user_id;');
 end if;
end $patch$;

notify pgrst,'reload schema';
commit;
