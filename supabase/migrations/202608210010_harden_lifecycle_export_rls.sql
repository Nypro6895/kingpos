-- Require export metadata rows to be authorized for the requested subject.

create or replace function public.lifecycle_export_request_is_authorized(
  p_export_type text,
  p_account_id uuid,
  p_salon_id uuid,
  p_subject_user_id uuid,
  p_requested_by_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
begin
  if actor_user_id is null then
    return false;
  end if;

  if p_requested_by_user_id is distinct from actor_user_id then
    return false;
  end if;

  if p_export_type = 'salon_lifecycle' then
    if p_salon_id is null then
      return false;
    end if;

    return public.lifecycle_user_is_salon_owner(p_salon_id, actor_user_id, true)
      or public.user_has_salon_permission(
        p_salon_id,
        array['salon_settings.view', 'salon_settings.manage']
      );
  end if;

  if p_export_type in ('account_data', 'account_deletion') then
    return p_subject_user_id = actor_user_id
      and (
        p_account_id is null
        or public.user_belongs_to_account(p_account_id)
      );
  end if;

  return false;
end;
$$;

revoke all on function public.lifecycle_export_request_is_authorized(
  text,
  uuid,
  uuid,
  uuid,
  uuid
) from public;

grant execute on function public.lifecycle_export_request_is_authorized(
  text,
  uuid,
  uuid,
  uuid,
  uuid
) to authenticated;

drop policy if exists "lifecycle_export_requester_insert" on public.lifecycle_exports;
create policy "lifecycle_export_requester_insert" on public.lifecycle_exports
for insert to authenticated
with check (
  public.lifecycle_export_request_is_authorized(
    export_type,
    account_id,
    salon_id,
    subject_user_id,
    requested_by_user_id
  )
);

drop policy if exists "lifecycle_export_requester_update" on public.lifecycle_exports;
create policy "lifecycle_export_requester_update" on public.lifecycle_exports
for update to authenticated
using (requested_by_user_id = public.current_public_user_id())
with check (
  public.lifecycle_export_request_is_authorized(
    export_type,
    account_id,
    salon_id,
    subject_user_id,
    requested_by_user_id
  )
);
