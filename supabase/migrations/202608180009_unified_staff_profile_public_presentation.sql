drop function if exists public.get_public_salon_profile_staff(uuid);
drop function if exists public.set_own_staff_online_booking(uuid, boolean);

update public.staff
set online_booking_enabled = is_active and online_booking_enabled,
    salon_profile_content_posting_enabled =
      is_active and salon_profile_content_posting_enabled,
    owner_public_enabled =
      is_active and (
        online_booking_enabled or salon_profile_content_posting_enabled
      ),
    public_profile_visible =
      is_active and (
        online_booking_enabled or salon_profile_content_posting_enabled
      ),
    staff_public_consent_status =
      case
        when is_active and (
          online_booking_enabled or salon_profile_content_posting_enabled
        ) then 'granted'
        else 'not_requested'
      end
where online_booking_enabled is distinct from (is_active and online_booking_enabled)
   or salon_profile_content_posting_enabled is distinct from (
        is_active and salon_profile_content_posting_enabled
      )
   or owner_public_enabled is distinct from (
        is_active and (
          online_booking_enabled or salon_profile_content_posting_enabled
        )
      )
   or public_profile_visible is distinct from (
        is_active and (
          online_booking_enabled or salon_profile_content_posting_enabled
        )
      )
   or staff_public_consent_status is distinct from (
        case
          when is_active and (
            online_booking_enabled or salon_profile_content_posting_enabled
          ) then 'granted'
          else 'not_requested'
        end
      );

drop function if exists public.update_staff_public_team_batch(uuid, uuid, jsonb);

create or replace function public.update_staff_public_team_batch(
  target_account_id uuid,
  target_salon_id uuid,
  changes jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_count integer := 0;
  changed_rows integer := 0;
  item jsonb;
begin
  if not exists (
    select 1 from public.locations
    where id = target_salon_id and account_id = target_account_id
  ) then
    raise exception 'Salon is not part of the selected account.';
  end if;

  for item in select * from jsonb_array_elements(coalesce(changes, '[]'::jsonb))
  loop
    with next_values as (
      select
        staff.id,
        staff.is_active and coalesce(
          (item->>'online_booking_enabled')::boolean,
          staff.online_booking_enabled
        ) as online_booking_enabled,
        coalesce(
          (item->>'profile_display_order')::integer,
          staff.profile_display_order
        ) as profile_display_order,
        staff.is_active and coalesce(
          (item->>'salon_profile_content_posting_enabled')::boolean,
          staff.salon_profile_content_posting_enabled
        ) as salon_profile_content_posting_enabled
      from public.staff
      where staff.id = (item->>'staff_id')::uuid
        and staff.salon_id = target_salon_id
    )
    update public.staff
    set online_booking_enabled = next_values.online_booking_enabled,
        owner_public_enabled =
          next_values.online_booking_enabled
          or next_values.salon_profile_content_posting_enabled,
        profile_display_order = next_values.profile_display_order,
        public_profile_visible =
          next_values.online_booking_enabled
          or next_values.salon_profile_content_posting_enabled,
        salon_profile_content_posting_enabled =
          next_values.salon_profile_content_posting_enabled,
        staff_public_consent_status =
          case
            when next_values.online_booking_enabled
              or next_values.salon_profile_content_posting_enabled
            then 'granted'
            else 'not_requested'
          end
    from next_values
    where staff.id = next_values.id;

    get diagnostics changed_rows = row_count;
    changed_count := changed_count + changed_rows;
  end loop;

  return changed_count;
end;
$$;

revoke all on function public.update_staff_public_team_batch(uuid, uuid, jsonb) from public;
grant execute on function public.update_staff_public_team_batch(uuid, uuid, jsonb) to authenticated;

create or replace function public.get_public_salon_profile_staff(target_salon_id uuid)
returns table (
  id uuid,
  display_name text,
  job_title text,
  avatar_path text,
  account_avatar_url text,
  bio text,
  online_booking_enabled boolean,
  specialties text[],
  portfolio_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    staff.id,
    staff.display_name,
    staff.job_title,
    staff.public_profile_photo_path,
    account_users.avatar_url,
    staff.public_bio,
    staff.online_booking_enabled,
    staff.specialties,
    (
      select count(*)
      from public.salon_profile_looks looks
      where looks.author_staff_id = staff.id
        and looks.status = 'published'
    )
  from public.staff
  left join public.users account_users on account_users.id = staff.account_user_id
  where staff.salon_id = target_salon_id
    and staff.is_active = true
    and staff.public_profile_visible = true
    and public.salon_profile_public_salon_exists(target_salon_id)
  order by staff.profile_display_order, staff.display_name
$$;

revoke all on function public.get_public_salon_profile_staff(uuid) from public;
grant execute on function public.get_public_salon_profile_staff(uuid) to anon, authenticated;

create or replace function public.get_public_booking_context(
  target_salon_id uuid,
  p_range_start timestamptz,
  p_range_end timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'state',
      case
        when settings.salon_id is null then 'not_found'
        when booking_settings.booking_enabled is not true
          or booking_settings.online_booking_visible is not true
          or booking_settings.guest_booking_enabled is not true
        then 'booking_disabled'
        else 'ready'
      end,
    'profile',
      jsonb_build_object(
        'salon_id', salons.id,
        'name', salons.name,
        'phone', salons.phone,
        'address_line1', salons.address_line1,
        'city', salons.city,
        'state', salons.state,
        'tagline', settings.public_profile_tagline,
        'website', settings.website,
        'email', settings.email,
        'logo_path', settings.public_profile_logo_path,
        'cover_path', settings.public_profile_cover_path,
        'public_discovery_enabled', coalesce(settings.public_discovery_enabled, false)
      ),
    'settings', to_jsonb(booking_settings),
    'services',
      coalesce((
        select jsonb_agg(to_jsonb(services) order by services.name)
        from public.services
        where services.salon_id = target_salon_id
          and services.is_active = true
          and services.online_booking_enabled = true
      ), '[]'::jsonb),
    'add_on_links',
      coalesce((
        select jsonb_agg(to_jsonb(service_add_on_links) order by service_add_on_links.display_order)
        from public.service_add_on_links
        where service_add_on_links.salon_id = target_salon_id
          and service_add_on_links.is_active = true
      ), '[]'::jsonb),
    'staff',
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', staff.id,
          'display_name', staff.display_name,
          'job_title', staff.job_title,
          'avatar_path', staff.public_profile_photo_path,
          'account_avatar_url', account_users.avatar_url,
          'bio', staff.public_bio,
          'specialties', staff.specialties
        ) order by staff.profile_display_order, staff.display_name)
        from public.staff
        left join public.users account_users on account_users.id = staff.account_user_id
        where staff.salon_id = target_salon_id
          and staff.is_active = true
          and staff.online_booking_enabled = true
      ), '[]'::jsonb),
    'assignments',
      coalesce((
        select jsonb_agg(to_jsonb(staff_service_assignments))
        from public.staff_service_assignments
        where staff_service_assignments.salon_id = target_salon_id
          and staff_service_assignments.is_active = true
          and staff_service_assignments.online_bookable = true
      ), '[]'::jsonb),
    'availability_rules',
      coalesce((
        select jsonb_agg(to_jsonb(staff_availability_rules))
        from public.staff_availability_rules
        where staff_availability_rules.salon_id = target_salon_id
          and staff_availability_rules.is_active = true
      ), '[]'::jsonb),
    'time_blocks',
      coalesce((
        select jsonb_agg(to_jsonb(staff_time_blocks))
        from public.staff_time_blocks
        where staff_time_blocks.salon_id = target_salon_id
          and staff_time_blocks.is_active = true
          and staff_time_blocks.starts_at < p_range_end
          and staff_time_blocks.ends_at > p_range_start
      ), '[]'::jsonb),
    'busy_lines',
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'booking_id', booking_lines.booking_id,
          'staff_id', booking_lines.assigned_staff_id,
          'scheduled_start_at', booking_lines.scheduled_start_at,
          'scheduled_end_at', booking_lines.scheduled_end_at
        ))
        from public.booking_lines
        join public.bookings on bookings.id = booking_lines.booking_id
        where booking_lines.salon_id = target_salon_id
          and booking_lines.assigned_staff_id is not null
          and booking_lines.scheduled_start_at < p_range_end
          and booking_lines.scheduled_end_at > p_range_start
          and bookings.status not in ('cancelled', 'no_show')
      ), '[]'::jsonb),
    'looks',
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', looks.id,
          'title', looks.title,
          'caption', looks.caption,
          'media_path', looks.media_path,
          'booking_note', looks.booking_note,
          'recommended_staff_id', looks.recommended_staff_id,
          'recommended_staff_name', recommended_staff.display_name,
          'service_id', looks.service_id,
          'service_name', services.name
        ) order by looks.is_pinned desc, looks.published_at desc)
        from public.salon_profile_looks looks
        left join public.staff recommended_staff on recommended_staff.id = looks.recommended_staff_id
        left join public.services services on services.id = looks.service_id
        where looks.salon_id = target_salon_id
          and looks.status = 'published'
      ), '[]'::jsonb)
  )
  from public.locations salons
  left join public.salon_settings settings on settings.salon_id = salons.id
  left join public.booking_settings booking_settings on booking_settings.salon_id = salons.id
  where salons.id = target_salon_id
$$;

revoke all on function public.get_public_booking_context(uuid, timestamptz, timestamptz) from public;
grant execute on function public.get_public_booking_context(uuid, timestamptz, timestamptz) to anon, authenticated;
