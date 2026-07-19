with source as (
  select
    existing_looks.organization_id,
    existing_looks.salon_id,
    existing_looks.media_path,
    assignments.service_id,
    assignments.staff_id,
    services.name as service_name,
    staff.display_name as staff_name
  from public.salon_profile_looks existing_looks
  left join public.salon_profile_media_assets assets
    on assets.bucket = 'salon-profile-media'
    and assets.object_path = existing_looks.media_path
    and assets.organization_id = existing_looks.organization_id
    and assets.salon_id = existing_looks.salon_id
  join storage.objects storage_objects
    on storage_objects.bucket_id = coalesce(assets.bucket, 'salon-profile-media')
    and storage_objects.name = existing_looks.media_path
  join public.booking_settings booking_settings
    on booking_settings.salon_id = existing_looks.salon_id
    and booking_settings.organization_id = existing_looks.organization_id
    and booking_settings.booking_enabled = true
    and booking_settings.online_booking_visible = true
  join public.staff_service_assignments assignments
    on assignments.salon_id = existing_looks.salon_id
    and assignments.organization_id = existing_looks.organization_id
    and assignments.is_active = true
    and assignments.online_bookable = true
  join public.services services
    on services.id = assignments.service_id
    and services.salon_id = assignments.salon_id
    and services.organization_id = assignments.organization_id
    and services.is_active = true
    and services.online_booking_enabled = true
    and not exists (
      select 1
      from public.service_add_on_links add_on_links
      where add_on_links.salon_id = services.salon_id
        and add_on_links.organization_id = services.organization_id
        and add_on_links.add_on_service_id = services.id
        and add_on_links.is_active = true
    )
  join public.staff staff
    on staff.id = assignments.staff_id
    and staff.salon_id = assignments.salon_id
    and staff.organization_id = assignments.organization_id
    and staff.is_active = true
    and staff.public_profile_visible = true
    and staff.owner_public_enabled = true
    and staff.staff_public_consent_status = 'granted'
    and staff.online_booking_enabled = true
  where existing_looks.status = 'published'
    and existing_looks.media_path is not null
    and public.salon_profile_public_salon_exists(existing_looks.salon_id)
    and (
      assets.id is null
      or (
        assets.status = 'active'
        and assets.deleted_at is null
        and assets.quarantined_at is null
      )
    )
  order by coalesce(existing_looks.published_at, existing_looks.created_at) desc
  limit 1
),
cleanup as (
  delete from public.salon_profile_looks looks
  where looks.title = 'Codex QA Bookable Inspiration'
    and looks.booking_note = 'codex-booking-inspiration-browser-qa'
  returning looks.id
),
inserted as (
  insert into public.salon_profile_looks (
    organization_id,
    salon_id,
    title,
    caption,
    booking_note,
    media_path,
    service_id,
    recommended_staff_id,
    status,
    published_at,
    is_pinned
  )
  select
    source.organization_id,
    source.salon_id,
    'Codex QA Bookable Inspiration',
    'Marked browser QA look for the Explore to booking inspiration handoff.',
    'codex-booking-inspiration-browser-qa',
    source.media_path,
    source.service_id,
    source.staff_id,
    'published',
    now(),
    true
  from source
  returning id, salon_id, service_id, recommended_staff_id
)
select
  inserted.id as look_id,
  inserted.salon_id,
  inserted.service_id,
  inserted.recommended_staff_id,
  '/book/' || inserted.salon_id::text || '?source=explore&inspiration=' || inserted.id::text
    as booking_href,
  source.service_name,
  source.staff_name
from inserted
join source on true;
