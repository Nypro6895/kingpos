alter table public.staff
alter column salon_profile_content_posting_enabled set default true;

update public.staff
set salon_profile_content_posting_enabled = true
where is_active = true
  and salon_profile_content_posting_enabled = false;

create or replace function public.update_staff_public_team_batch(
  target_organization_id uuid,
  target_salon_id uuid,
  changes jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
  updated_count integer;
begin
  if changes is null or jsonb_typeof(changes) <> 'array' then
    raise exception 'Changes must be a JSON array.';
  end if;

  if not public.user_has_organization_permission(
    target_organization_id,
    array['salon_settings.manage']
  ) then
    raise exception 'You do not have permission to manage public team settings.';
  end if;

  if not exists (
    select 1
    from public.locations
    where locations.id = target_salon_id
      and locations.organization_id = target_organization_id
  ) then
    raise exception 'Selected salon was not found.';
  end if;

  with payload as (
    select *
    from jsonb_to_recordset(changes) as input(
      staff_id uuid,
      owner_public_enabled boolean,
      online_booking_enabled boolean,
      salon_profile_content_posting_enabled boolean,
      profile_display_order integer
    )
  )
  select count(*)
  into expected_count
  from payload;

  if expected_count = 0 then
    return 0;
  end if;

  with payload as (
    select *
    from jsonb_to_recordset(changes) as input(
      staff_id uuid,
      owner_public_enabled boolean,
      online_booking_enabled boolean,
      salon_profile_content_posting_enabled boolean,
      profile_display_order integer
    )
  )
  select count(distinct staff_id)
  into updated_count
  from payload;

  if updated_count <> expected_count then
    raise exception 'Each staff profile can only appear once in a batch.';
  end if;

  if exists (
    with payload as (
      select *
      from jsonb_to_recordset(changes) as input(
        staff_id uuid,
        owner_public_enabled boolean,
        online_booking_enabled boolean,
        salon_profile_content_posting_enabled boolean,
        profile_display_order integer
      )
    )
    select 1
    from payload
    left join public.staff
      on staff.id = payload.staff_id
      and staff.organization_id = target_organization_id
      and staff.salon_id = target_salon_id
    where payload.staff_id is null
      or staff.id is null
  ) then
    raise exception 'All staff profiles must belong to the selected salon.';
  end if;

  with payload as (
    select *
    from jsonb_to_recordset(changes) as input(
      staff_id uuid,
      owner_public_enabled boolean,
      online_booking_enabled boolean,
      salon_profile_content_posting_enabled boolean,
      profile_display_order integer
    )
  )
  update public.staff
  set
    online_booking_enabled = coalesce(payload.online_booking_enabled, false),
    owner_public_enabled = coalesce(payload.owner_public_enabled, false),
    profile_display_order = coalesce(payload.profile_display_order, 0),
    public_profile_visible =
      coalesce(payload.owner_public_enabled, false)
      and staff.staff_public_consent_status = 'granted',
    salon_profile_content_posting_enabled =
      coalesce(payload.salon_profile_content_posting_enabled, false),
    updated_at = now()
  from payload
  where staff.id = payload.staff_id
    and staff.organization_id = target_organization_id
    and staff.salon_id = target_salon_id;

  get diagnostics updated_count = row_count;

  if updated_count <> expected_count then
    raise exception 'Public team batch did not update every requested staff profile.';
  end if;

  return updated_count;
end;
$$;

revoke all on function public.update_staff_public_team_batch(uuid, uuid, jsonb)
from public;

grant execute on function public.update_staff_public_team_batch(uuid, uuid, jsonb)
to authenticated;
