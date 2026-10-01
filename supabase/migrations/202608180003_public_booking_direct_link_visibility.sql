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
          'bio', staff.public_bio,
          'specialties', staff.specialties
        ) order by staff.profile_display_order, staff.display_name)
        from public.staff
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
