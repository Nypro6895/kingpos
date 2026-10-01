-- Direct authenticated table writes must not bypass lifecycle RPCs/audit.

create or replace function public.prevent_direct_user_lifecycle_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated')
    and (
      new.auth_user_id is distinct from old.auth_user_id
      or new.status is distinct from old.status
      or new.deletion_requested_at is distinct from old.deletion_requested_at
      or new.deletion_scheduled_for is distinct from old.deletion_scheduled_for
      or new.deleted_at is distinct from old.deleted_at
      or new.anonymized_at is distinct from old.anonymized_at
      or new.deletion_finalization_started_at is distinct from old.deletion_finalization_started_at
      or new.deletion_finalized_at is distinct from old.deletion_finalized_at
      or new.deletion_finalization_attempts is distinct from old.deletion_finalization_attempts
      or new.deletion_finalization_failed_at is distinct from old.deletion_finalization_failed_at
      or new.deletion_finalization_error is distinct from old.deletion_finalization_error
    )
  then
    raise exception 'Use the account lifecycle RPCs to change account deletion state.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_direct_user_lifecycle_write on public.users;
create trigger prevent_direct_user_lifecycle_write
before update of
  auth_user_id,
  status,
  deletion_requested_at,
  deletion_scheduled_for,
  deleted_at,
  anonymized_at,
  deletion_finalization_started_at,
  deletion_finalized_at,
  deletion_finalization_attempts,
  deletion_finalization_failed_at,
  deletion_finalization_error
on public.users
for each row execute function public.prevent_direct_user_lifecycle_write();

create or replace function public.prevent_direct_salon_lifecycle_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated')
    and new.status is distinct from old.status
  then
    raise exception 'Use the salon lifecycle RPCs to change salon lifecycle state.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_direct_salon_lifecycle_write on public.locations;
create trigger prevent_direct_salon_lifecycle_write
before update of status on public.locations
for each row execute function public.prevent_direct_salon_lifecycle_write();
