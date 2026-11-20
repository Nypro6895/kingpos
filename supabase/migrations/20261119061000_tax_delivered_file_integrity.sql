-- Preserve delivered Tax document file integrity; ordinary application workflows retain new-version paths.
-- Forward migration: 20261119061000_tax_delivered_file_integrity.sql
-- Freeze only delivered exact keys; no generic payroll-bucket write ban.
begin;
set local lock_timeout='1s';
set local statement_timeout='30s';

-- Fail rather than silently adapt to a different Storage/provider schema.
do $dependencies$
begin
 if to_regclass('public.tax_documents') is null
 or to_regclass('public.payroll_paystubs') is null
 or to_regclass('public.account_erasure_objects') is null
 or to_regclass('public.account_erasure_jobs') is null
 or to_regprocedure('storage.allow_only_operation(text)') is null
 or to_regprocedure('storage.allow_any_operation(text[])') is null
 or to_regprocedure('public.detach_retained_storage_copy_owner()') is null then
  raise exception 'Delivered Tax file guard dependencies unavailable.';
 end if;
 if (select count(*) from pg_attribute where attrelid='storage.objects'::regclass and not attisdropped
  and attname=any(array['id','bucket_id','name','version','metadata','user_metadata','owner','owner_id','last_accessed_at','updated_at']))<>10 then
  raise exception 'Storage object schema changed; review the Tax file guard.';
 end if;
end $dependencies$;

-- tax_documents already has UNIQUE(bucket,path). The legacy current pointer
-- needs an exact-path lookup too; no scan/backfill/rewrite of document payloads.
create index if not exists tax_delivered_paystub_object_path_idx
 on public.payroll_paystubs(file_url_or_path) where file_url_or_path is not null;

create or replace function public.tax_file_direct_maintenance()
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select session_user in('postgres','supabase_admin')
 and current_setting('role',true) in('none','postgres','supabase_admin')
$$;

create or replace function public.tax_file_key_fence(p_keys text[])
returns void language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare object_key text;
begin
 -- VOLATILE does not refresh a REPEATABLE READ/SERIALIZABLE snapshot. Only
 -- READ COMMITTED can re-read a delivery committed before this key is fenced.
 -- Reject before acquiring ANY nonempty key, including reentrant acquisitions.
 if exists(select 1 from unnest(coalesce(p_keys,'{}')) as k(key) where key is not null)
  and current_setting('transaction_isolation') is distinct from 'read committed' then
  raise exception 'Tax file integrity requires READ COMMITTED.' using errcode='25000';
 end if;
 -- Every caller takes the same short per-key transaction fence. The Storage
 -- UPDATE executor can already own a tuple lock before a BEFORE trigger runs;
 -- NOWAIT-style try locks avoid a tuple->key vs key->tuple wait cycle.
 for object_key in select distinct key from unnest(coalesce(p_keys,'{}')) as k(key)
  where key is not null order by key loop
  if not pg_try_advisory_xact_lock(hashtextextended('reylumi.tax-file-integrity.v1:'||object_key,0)) then
   raise exception 'Tax document file is busy. Retry the operation.' using errcode='55P03';
  end if;
 end loop;
end $$;

create or replace function public.tax_file_is_delivered(p_bucket text,p_path text)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog,public as $$
begin
 if p_bucket is distinct from 'payroll-paystubs' or p_path is null then return false;end if;
 -- Must execute AFTER tax_file_key_fence under a fresh VOLATILE SPI snapshot.
 -- Do not replace with the existing STABLE tax_file_retained helper.
 return exists(select 1 from public.tax_documents d where d.bucket=p_bucket and d.path=p_path)
  or exists(select 1 from public.payroll_paystubs p where p.file_url_or_path=p_path);
end $$;

create or replace function public.guard_tax_file_registration()
returns trigger language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare keys text[]:='{}';
begin
 if tg_table_schema<>'public' or tg_table_name not in('tax_documents','payroll_paystubs') then
  raise exception 'Invalid Tax file registration trigger.' using errcode='42501';
 end if;
 if tg_table_name='tax_documents' then
  if tg_op<>'INSERT' and old.bucket='payroll-paystubs' and old.path is not null then
   keys:=array_append(keys,'payroll-paystubs/'||old.path);
  end if;
  if tg_op<>'DELETE' and new.bucket='payroll-paystubs' and new.path is not null then
   keys:=array_append(keys,'payroll-paystubs/'||new.path);
  end if;
  perform public.tax_file_key_fence(keys);
  -- Product actions archive/restore/tombstone. Removing or moving a canonical
  -- delivered identity would release its Storage fence and defeat immutability.
  if tg_op='DELETE' and old.bucket='payroll-paystubs' and not public.tax_file_direct_maintenance() then
   raise exception 'Delivered document identity is retained. Use archive or Owner removal.' using errcode='42501';
  end if;
  if tg_op='UPDATE' and old.bucket='payroll-paystubs'
   and row(new.id,new.bucket,new.path) is distinct from row(old.id,old.bucket,old.path)
   and not public.tax_file_direct_maintenance() then
   raise exception 'Delivered document identity is immutable.' using errcode='42501';
  end if;
 else
  if tg_op<>'INSERT' and old.file_url_or_path is not null then
   keys:=array_append(keys,'payroll-paystubs/'||old.file_url_or_path);
  end if;
  if tg_op<>'DELETE' and new.file_url_or_path is not null then
   keys:=array_append(keys,'payroll-paystubs/'||new.file_url_or_path);
  end if;
  perform public.tax_file_key_fence(keys);
  -- Official replacement uses a fresh UUID and preserves the old Tax history.
  -- An unregistered historical pointer must not silently lose its only fence.
  if tg_op<>'INSERT' and old.file_url_or_path is not null
   and (tg_op='DELETE' or new.file_url_or_path is distinct from old.file_url_or_path)
   and not public.tax_file_direct_maintenance()
   and not exists(select 1 from public.tax_documents d
    where d.bucket='payroll-paystubs' and d.path=old.file_url_or_path) then
   raise exception 'Existing paystub history must be preserved before replacement.' using errcode='42501';
  end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;

create or replace function public.guard_tax_delivered_file_storage()
returns trigger language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare
 keys text[]:='{}'; old_protected boolean:=false; new_protected boolean:=false;
 existing_object storage.objects; retained_auth uuid; claims jsonb; trusted boolean;
begin
 if tg_op<>'INSERT' and old.bucket_id='payroll-paystubs' then
  keys:=array_append(keys,'payroll-paystubs/'||old.name);
 end if;
 if tg_op<>'DELETE' and new.bucket_id='payroll-paystubs' then
  keys:=array_append(keys,'payroll-paystubs/'||new.name);
 end if;
 if cardinality(keys)=0 then return case when tg_op='DELETE' then old else new end;end if;

 -- A pure last-access/updated timestamp touch changes no payload, key, owner,
 -- version or metadata. Avoid contending with reads. All other columns, including
 -- future Storage columns, remain in the full-row JSON comparison.
 if tg_op='UPDATE'
  and (to_jsonb(new)-array['last_accessed_at','updated_at']) is not distinct from
      (to_jsonb(old)-array['last_accessed_at','updated_at'])
  and not coalesce(storage.allow_any_operation(array['object.upload_signed']),false) then
  return new;
 end if;

 perform public.tax_file_key_fence(keys);
 if tg_op<>'INSERT' then old_protected:=public.tax_file_is_delivered(old.bucket_id,old.name);end if;
 if tg_op<>'DELETE' then new_protected:=public.tax_file_is_delivered(new.bucket_id,new.name);end if;
 if not old_protected and not new_protected then
  -- Includes both ordinary canUpload permission probes and final commits for
  -- fresh, not-yet-delivered UUID paths. Final delivery shares this same fence.
  return case when tg_op='DELETE' then old else new end;
 end if;
 if public.tax_file_direct_maintenance() then
  -- Explicit direct DB maintenance, never definer current_user or API role.
  return case when tg_op='DELETE' then old else new end;
 end if;
 if coalesce(storage.allow_any_operation(array['object.upload_signed']),false) then
  raise exception 'Delivered Tax file bytes are immutable.' using errcode='42501';
 end if;

 claims:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
 trusted:=coalesce(claims->>'role',nullif(current_setting('request.jwt.claim.role',true),''),'')='service_role';
 if tg_op<>'DELETE' and trusted and coalesce(storage.allow_only_operation('object.copy'),false)
  and new.bucket_id='payroll-paystubs'
  and (tg_op<>'UPDATE' or row(new.bucket_id,new.name) is not distinct from row(old.bucket_id,old.name)) then
  -- Same existing-target/metadata contract as the shipped retain_business COPY.
  -- An INSERT permission probe does not need the final Storage id/version.
  -- It must still describe the exact existing target bytes; no generic version1
  -- or contentLength-only exemption is granted for a delivered key.
  select * into existing_object from storage.objects
   where bucket_id=new.bucket_id and name=new.name;
  if existing_object.id is not null
   and existing_object.metadata->>'eTag' is not null
   and existing_object.metadata->>'eTag'=new.metadata->>'eTag'
   and existing_object.metadata->>'size'=new.metadata->>'size'
   and existing_object.metadata->>'mimetype'=new.metadata->>'mimetype'
   and (tg_op='INSERT' or new.user_metadata is not distinct from existing_object.user_metadata) then
   select job.auth_user_id into retained_auth
   from public.account_erasure_objects task
   join public.account_erasure_jobs job on job.user_id=task.user_id
   join public.users debtor on debtor.id=job.user_id
   where task.bucket_id=new.bucket_id and task.object_path=new.name
    and task.disposition='retain_business' and task.completed_at is null
    and job.status='processing' and job.lease_token is not null
    and job.leased_until>clock_timestamp() and job.auth_user_id is not null
    and debtor.status in('pending_deletion','deleted')
    and (existing_object.owner is null or existing_object.owner=job.auth_user_id)
    and (existing_object.owner_id is null or existing_object.owner_id=job.auth_user_id::text)
    and (new.owner is null or new.owner=job.auth_user_id)
    and (new.owner_id is null or new.owner_id=job.auth_user_id::text)
   order by job.created_at limit 1 for share of task,job,debtor nowait;
   if retained_auth is not null then
    -- Existing zz_detach_retained_storage_copy_owner performs owner detachment.
    -- Do not modify ownership here or bypass its strict worker checkpoint.
    return new;
   end if;
  end if;
 end if;
 raise exception 'Delivered Tax file bytes are immutable. Upload a new document version.' using errcode='42501';
end $$;

revoke all on function public.tax_file_direct_maintenance(),public.tax_file_key_fence(text[]),
 public.tax_file_is_delivered(text,text),public.guard_tax_file_registration(),public.guard_tax_delivered_file_storage()
 from public,anon,authenticated,service_role;

drop trigger if exists guard_tax_file_registration on public.tax_documents;
create trigger guard_tax_file_registration before insert or delete or update of id,bucket,path on public.tax_documents
 for each row execute function public.guard_tax_file_registration();
drop trigger if exists guard_tax_paystub_registration on public.payroll_paystubs;
create trigger guard_tax_paystub_registration before insert or delete or update of file_url_or_path on public.payroll_paystubs
 for each row execute function public.guard_tax_file_registration();
drop trigger if exists guard_tax_delivered_file_storage on storage.objects;
create trigger guard_tax_delivered_file_storage before insert or update or delete on storage.objects
 for each row execute function public.guard_tax_delivered_file_storage();

-- No read-policy, signer ACL, upload RPC, payroll amount or publication mutation.
notify pgrst,'reload schema';
commit;
