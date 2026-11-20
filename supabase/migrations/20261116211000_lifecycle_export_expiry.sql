begin;

do $$
begin
  if to_regprocedure('storage.allow_only_operation(text)') is null
     or to_regprocedure('storage.allow_any_operation(text[])') is null then
    raise exception 'Storage operation-aware RLS is required; verify provider before integration.';
  end if;
end;
$$;

-- Existing archives need a bounded review before any historical physical purge.
-- Their access still expires below. Only newly created exports enter this queue.
alter table public.lifecycle_exports
  add column if not exists expiry_cleanup_enabled boolean not null default false,
  add column if not exists expiry_cleanup_lease uuid,
  add column if not exists expiry_cleanup_claimed_at timestamptz,
  add column if not exists expiry_cleanup_attempts integer not null default 0,
  add column if not exists storage_deleted_at timestamptz;

create index if not exists lifecycle_exports_expiry_cleanup_idx
on public.lifecycle_exports (expires_at, expiry_cleanup_claimed_at)
where expiry_cleanup_enabled and storage_deleted_at is null;

-- Invoker authority is intentional: authenticated updates cannot extend an
-- archive's life or point a cleanup job at another object.
create or replace function public.guard_lifecycle_export_lifetime()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.requested_by_user_id is null
       or new.storage_bucket <> 'lifecycle-exports'
       or split_part(new.storage_path, '/', 1) <> new.requested_by_user_id::text
       or split_part(new.storage_path, '/', 2) <> new.id::text
       or array_length(string_to_array(new.storage_path, '/'), 1) <> 3
       or split_part(new.storage_path, '/', 3) !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'
       or new.status <> 'created' then
      raise exception 'Invalid lifecycle export identity.';
    end if;
    new.created_at := clock_timestamp();
    new.expires_at := new.created_at + interval '7 days';
    new.expiry_cleanup_enabled := true;
    new.expiry_cleanup_lease := null;
    new.expiry_cleanup_claimed_at := null;
    new.expiry_cleanup_attempts := 0;
    new.storage_deleted_at := null;
    return new;
  end if;

  if current_user = 'service_role'
     or current_user = pg_get_userbyid(
       (select relowner from pg_class where oid = 'public.lifecycle_exports'::regclass)
     ) then
    return new;
  end if;

  if row(new.id, new.export_type, new.account_id, new.salon_id,
         new.subject_user_id, new.requested_by_user_id, new.storage_bucket,
         new.storage_path, new.content_type, new.manifest, new.created_at,
         new.expires_at, new.expiry_cleanup_enabled, new.expiry_cleanup_lease,
         new.expiry_cleanup_claimed_at, new.expiry_cleanup_attempts, new.storage_deleted_at)
     is distinct from
     row(old.id, old.export_type, old.account_id, old.salon_id,
         old.subject_user_id, old.requested_by_user_id, old.storage_bucket,
         old.storage_path, old.content_type, old.manifest, old.created_at,
         old.expires_at, old.expiry_cleanup_enabled, old.expiry_cleanup_lease,
         old.expiry_cleanup_claimed_at, old.expiry_cleanup_attempts, old.storage_deleted_at)
     or old.expires_at <= clock_timestamp()
     or old.status = 'expired'
     or not (
       new.status = old.status
       or (old.status = 'created' and new.status in ('stored', 'failed'))
     ) then
    raise exception 'Lifecycle export identity and expiry cannot be changed.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_lifecycle_export_lifetime() from public, anon, authenticated;

drop trigger if exists guard_lifecycle_export_lifetime on public.lifecycle_exports;
create trigger guard_lifecycle_export_lifetime
before insert or update on public.lifecycle_exports
for each row execute function public.guard_lifecycle_export_lifetime();

-- Restrictive gates also cover any other permissive policy on the shared
-- storage table. They do not change access to another bucket.
drop policy if exists lifecycle_export_unexpired_metadata on public.lifecycle_exports;
create policy lifecycle_export_unexpired_metadata on public.lifecycle_exports
as restrictive for select to authenticated
using (expires_at > clock_timestamp() and status <> 'expired' and storage_deleted_at is null);

drop policy if exists lifecycle_export_no_client_metadata_delete on public.lifecycle_exports;
create policy lifecycle_export_no_client_metadata_delete on public.lifecycle_exports
as restrictive for delete to authenticated using (false);

drop policy if exists lifecycle_export_requesters_read_objects on storage.objects;
create policy lifecycle_export_requesters_read_objects on storage.objects
for select to authenticated using (
  bucket_id = 'lifecycle-exports'
  and storage.allow_any_operation(array[
    'object.get_authenticated', 'object.get_authenticated_info',
    'object.head_authenticated_info', 'object.list', 'object.list_v2'
  ])
  and exists (
    select 1 from public.lifecycle_exports e
    where e.storage_bucket = storage.objects.bucket_id
      and e.storage_path = storage.objects.name
      and e.requested_by_user_id = public.current_public_user_id()
      and e.status = 'stored'
      and e.expires_at > clock_timestamp()
      and e.storage_deleted_at is null
  )
);

drop policy if exists lifecycle_export_expiry_read_gate on storage.objects;
create policy lifecycle_export_expiry_read_gate on storage.objects
as restrictive for select to authenticated using (
  bucket_id <> 'lifecycle-exports'
  or (storage.allow_any_operation(array[
    'object.get_authenticated', 'object.get_authenticated_info',
    'object.head_authenticated_info', 'object.list', 'object.list_v2'
  ]) and exists (
    select 1 from public.lifecycle_exports e
    where e.storage_bucket = storage.objects.bucket_id
      and e.storage_path = storage.objects.name
      and e.requested_by_user_id = public.current_public_user_id()
      and e.status = 'stored'
      and e.expires_at > clock_timestamp()
      and e.storage_deleted_at is null
  ))
);

drop policy if exists lifecycle_export_requesters_insert_objects on storage.objects;
create policy lifecycle_export_requesters_insert_objects on storage.objects
for insert to authenticated with check (
  bucket_id = 'lifecycle-exports'
  and storage.allow_only_operation('object.upload')
  and exists (
    select 1 from public.lifecycle_exports e
    where e.storage_bucket = storage.objects.bucket_id
      and e.storage_path = storage.objects.name
      and e.requested_by_user_id = public.current_public_user_id()
      and e.status = 'created'
      and e.expires_at > clock_timestamp()
  )
);

drop policy if exists lifecycle_export_expiry_insert_gate on storage.objects;
create policy lifecycle_export_expiry_insert_gate on storage.objects
as restrictive for insert to authenticated with check (
  bucket_id <> 'lifecycle-exports'
  or (storage.allow_only_operation('object.upload') and exists (
    select 1 from public.lifecycle_exports e
    where e.storage_bucket = storage.objects.bucket_id
      and e.storage_path = storage.objects.name
      and e.requested_by_user_id = public.current_public_user_id()
      and e.status = 'created'
      and e.expires_at > clock_timestamp()
  ))
);

drop policy if exists lifecycle_export_requesters_update_objects on storage.objects;
drop policy if exists lifecycle_export_no_client_object_replace on storage.objects;
create policy lifecycle_export_no_client_object_replace on storage.objects
as restrictive for update to authenticated
using (bucket_id <> 'lifecycle-exports')
with check (bucket_id <> 'lifecycle-exports');

create or replace function public.claim_expired_lifecycle_exports(p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  item public.lifecycle_exports%rowtype;
  claim uuid;
  jobs jsonb := '[]'::jsonb;
begin
  for item in
    select e.* from public.lifecycle_exports e
    where e.expiry_cleanup_enabled
      and e.storage_deleted_at is null
      and e.expires_at <= clock_timestamp()
      and (e.expiry_cleanup_claimed_at is null
        or e.expiry_cleanup_claimed_at < clock_timestamp() - interval '15 minutes')
    order by e.expiry_cleanup_claimed_at nulls first, e.expires_at, e.id
    limit greatest(1, least(coalesce(p_limit, 10), 25))
    for update skip locked
  loop
    claim := gen_random_uuid();
    update public.lifecycle_exports
    set status = 'expired', expiry_cleanup_lease = claim,
        expiry_cleanup_claimed_at = clock_timestamp(),
        expiry_cleanup_attempts = expiry_cleanup_attempts + 1
    where id = item.id;
    jobs := jobs || jsonb_build_array(jsonb_build_object(
      'id', item.id, 'lease', claim, 'bucket', item.storage_bucket,
      'path', item.storage_path, 'requesterId', item.requested_by_user_id,
      'expiresAt', item.expires_at
    ));
  end loop;
  return jobs;
end;
$$;
revoke all on function public.claim_expired_lifecycle_exports(integer) from public, anon, authenticated;
grant execute on function public.claim_expired_lifecycle_exports(integer) to service_role;

create or replace function public.finish_lifecycle_export_expiry(p_export_id uuid, p_lease uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  item public.lifecycle_exports%rowtype;
begin
  select * into item from public.lifecycle_exports where id = p_export_id for update;
  -- Account erasure may already have removed the entire export record.
  if not found then return true; end if;
  if item.storage_deleted_at is not null then return true; end if;
  if not item.expiry_cleanup_enabled or item.status <> 'expired'
     or item.expires_at > clock_timestamp()
     or item.expiry_cleanup_lease is distinct from p_lease
     or p_lease is null then
    raise exception 'Invalid export expiry lease.';
  end if;
  if exists (
    select 1 from storage.objects
    where bucket_id = item.storage_bucket and name = item.storage_path
  ) then
    raise exception 'Export storage removal is not verified.';
  end if;
  update public.lifecycle_exports
  set storage_deleted_at = clock_timestamp(), expiry_cleanup_lease = null
  where id = item.id;
  return true;
end;
$$;
revoke all on function public.finish_lifecycle_export_expiry(uuid, uuid) from public, anon, authenticated;
grant execute on function public.finish_lifecycle_export_expiry(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
