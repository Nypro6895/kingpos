-- Independent of the later public-image pipeline. Storage's same-path service
-- COPY omits an undefined JWT owner from its UPSERT
-- merge. Detach only a deleting account's ownership inside that API transaction;
-- keep Storage responsible for the copy, version, metadata and blob lifecycle.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create or replace function public.detach_retained_storage_copy_owner()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare claims jsonb; retained_auth uuid;
begin
 if new.bucket_id not in ('salon-profile-media','pos-display-media','payroll-paystubs','support-evidence')
  or not coalesce(storage.allow_only_operation('object.copy'),false) then return new;end if;
 claims:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
 if coalesce(claims->>'role',nullif(current_setting('request.jwt.claim.role',true),''),'')<>'service_role' then return new;end if;

 select j.auth_user_id into retained_auth
 from public.account_erasure_objects e
 join public.account_erasure_jobs j on j.user_id=e.user_id
 join public.users u on u.id=e.user_id
 join storage.objects o on o.bucket_id=e.bucket_id and o.name=e.object_path
 where e.bucket_id=new.bucket_id and e.object_path=new.name
  and e.disposition='retain_business' and e.completed_at is null
  and j.status='processing' and j.lease_token is not null and j.leased_until>now() and j.auth_user_id is not null
  and u.status in ('pending_deletion','deleted')
  and o.metadata->>'eTag' is not null and o.metadata->>'eTag'=new.metadata->>'eTag'
  and o.metadata->>'size'=new.metadata->>'size' and o.metadata->>'mimetype'=new.metadata->>'mimetype'
  and (o.owner is null or o.owner=j.auth_user_id)
  and (o.owner_id is null or o.owner_id=j.auth_user_id::text)
  and (new.owner is null or new.owner=j.auth_user_id)
  and (new.owner_id is null or new.owner_id=j.auth_user_id::text)
 order by j.created_at limit 1 for share of e,j,u;
 if retained_auth is not null then
  new.owner:=null;
  new.owner_id:=null;
 end if;
 return new;
end $$;
revoke all on function public.detach_retained_storage_copy_owner() from public,anon,authenticated,service_role;
drop trigger if exists zz_detach_retained_storage_copy_owner on storage.objects;
-- Both events are necessary: COPY's INSERT probe can omit owner columns from
-- the conflict merge; the UPDATE NEW still contains the old owner to detach.
create trigger zz_detach_retained_storage_copy_owner before insert or update on storage.objects
 for each row execute function public.detach_retained_storage_copy_owner();
commit;
