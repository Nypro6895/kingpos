with cleanup_bookings as (
  update public.bookings bookings
  set
    status = 'cancelled',
    cancellation_reason = coalesce(
      nullif(btrim(bookings.cancellation_reason), ''),
      'Codex Q8 fixture setup cleanup'
    ),
    cancelled_at = coalesce(bookings.cancelled_at, now()),
    updated_at = now()
  where bookings.idempotency_key like 'codex-content-booking-v2-browser-qa%'
     or bookings.public_notes like 'codex-content-booking-v2-browser-qa%'
     or bookings.notes like 'codex-content-booking-v2-browser-qa%'
  returning bookings.id, bookings.customer_id
),
cleanup_customers as (
  update public.customers customers
  set
    name = 'Codex Q8 cleaned customer',
    phone = null,
    email = null,
    notes = 'Codex Q8 fixture cleaned',
    staff_notes = null,
    internal_notes = null,
    status = 'inactive',
    customer_user_id = null,
    updated_at = now()
  where customers.id in (select cleanup_bookings.customer_id from cleanup_bookings)
     or customers.email like 'codex-content-v2-browser-%@example.invalid'
     or customers.email like 'codex-content-v2-browser-%@example.com'
     or customers.notes like 'codex-content-booking-v2-browser-qa%'
  returning customers.id
),
cleanup_public_users as (
  update public.users users
  set
    auth_user_id = null,
    email = null,
    phone = null,
    first_name = null,
    last_name = null,
    display_name = 'Codex Q8 cleaned user',
    avatar_url = null,
    status = 'deleted',
    updated_at = now()
  where users.email like 'codex-content-v2-browser-%@example.invalid'
     or users.email like 'codex-content-v2-browser-%@example.com'
  returning users.id
),
cleanup_auth_users as (
  delete from auth.users users
  where users.email like 'codex-content-v2-browser-%@example.invalid'
     or users.email like 'codex-content-v2-browser-%@example.com'
  returning users.id
),
cleanup_rules as (
  delete from public.staff_availability_rules rules
  where rules.starts_at_local = '08:07:00'::time
    and rules.ends_at_local = '19:07:00'::time
    and rules.effective_start_date = current_date - 1
    and rules.effective_end_date = current_date + 45
  returning rules.id
),
cleanup_time_blocks as (
  delete from public.staff_time_blocks blocks
  where blocks.reason = 'codex-content-booking-v2-browser-qa slot race'
  returning blocks.id
),
cleanup_looks as (
  delete from public.salon_profile_looks looks
  where looks.booking_note = 'codex-content-booking-v2-browser-qa'
  returning looks.id
),
cleanup_updates as (
  delete from public.salon_profile_updates updates
  where updates.summary = 'codex-content-booking-v2-browser-qa'
     or updates.caption = 'codex-content-booking-v2-browser-qa'
  returning updates.id
),
look_source as (
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
    and booking_settings.guest_booking_enabled = true
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
      existing_looks.media_path like existing_looks.salon_id::text || '/looks/%'
      or (
        split_part(existing_looks.media_path, '/', 2) = existing_looks.salon_id::text
        and split_part(existing_looks.media_path, '/', 3) = 'looks'
      )
    )
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
invalid_source as (
  select
    look_source.organization_id,
    look_source.salon_id,
    look_source.media_path,
    look_source.staff_id,
    look_source.staff_name,
    invalid_services.id as invalid_service_id,
    invalid_services.name as invalid_service_name
  from look_source
  join public.service_add_on_links add_on_links
    on add_on_links.organization_id = look_source.organization_id
    and add_on_links.salon_id = look_source.salon_id
    and add_on_links.is_active = true
  join public.services invalid_services
    on invalid_services.id = add_on_links.add_on_service_id
    and invalid_services.organization_id = look_source.organization_id
    and invalid_services.salon_id = look_source.salon_id
    and invalid_services.is_active = true
  order by invalid_services.name
  limit 1
),
update_source as (
  select
    existing_updates.organization_id,
    existing_updates.salon_id,
    existing_updates.media_path
  from public.salon_profile_updates existing_updates
  left join public.salon_profile_media_assets assets
    on assets.bucket = 'salon-profile-media'
    and assets.object_path = existing_updates.media_path
    and assets.organization_id = existing_updates.organization_id
    and assets.salon_id = existing_updates.salon_id
  join storage.objects storage_objects
    on storage_objects.bucket_id = coalesce(assets.bucket, 'salon-profile-media')
    and storage_objects.name = existing_updates.media_path
  join public.booking_settings booking_settings
    on booking_settings.salon_id = existing_updates.salon_id
    and booking_settings.organization_id = existing_updates.organization_id
    and booking_settings.booking_enabled = true
    and booking_settings.online_booking_visible = true
    and booking_settings.guest_booking_enabled = true
  where existing_updates.status = 'published'
    and existing_updates.media_path is not null
    and existing_updates.media_path like existing_updates.salon_id::text || '/updates/%'
    and public.salon_profile_public_salon_exists(existing_updates.salon_id)
    and (
      assets.id is null
      or (
        assets.status = 'active'
        and assets.deleted_at is null
        and assets.quarantined_at is null
      )
    )
  order by coalesce(existing_updates.published_at, existing_updates.created_at) desc
  limit 1
),
guard as (
  select 1 / case
    when exists (select 1 from look_source)
      and exists (select 1 from invalid_source)
      and exists (select 1 from update_source)
    then 1
    else 0
  end as ok
),
availability_rules as (
  insert into public.staff_availability_rules (
    organization_id,
    salon_id,
    staff_id,
    rule_type,
    day_of_week,
    starts_at_local,
    ends_at_local,
    timezone_iana,
    effective_start_date,
    effective_end_date,
    is_active
  )
  select
    look_source.organization_id,
    look_source.salon_id,
    look_source.staff_id,
    'working',
    days.day_of_week,
    '08:07:00'::time,
    '19:07:00'::time,
    'America/Chicago',
    current_date - 1,
    current_date + 45,
    true
  from look_source, guard, generate_series(0, 6) as days(day_of_week)
  returning id
),
inserted_look as (
  insert into public.salon_profile_looks (
    organization_id,
    salon_id,
    title,
    caption,
    emotional_description,
    booking_note,
    media_path,
    service_id,
    recommended_staff_id,
    status,
    published_at,
    is_pinned
  )
  select
    look_source.organization_id,
    look_source.salon_id,
    'Codex V2 QA Quick Ready Look',
    'codex-content-booking-v2-browser-qa quick-ready',
    'codex-content-booking-v2-browser-qa',
    'codex-content-booking-v2-browser-qa',
    look_source.media_path,
    look_source.service_id,
    look_source.staff_id,
    'published',
    now(),
    true
  from look_source, guard
  returning id, organization_id, salon_id, service_id, recommended_staff_id
),
inserted_invalid_look as (
  insert into public.salon_profile_looks (
    organization_id,
    salon_id,
    title,
    caption,
    emotional_description,
    booking_note,
    media_path,
    service_id,
    recommended_staff_id,
    status,
    published_at,
    is_pinned
  )
  select
    invalid_source.organization_id,
    invalid_source.salon_id,
    'Codex V2 QA Invalid Original Look',
    'codex-content-booking-v2-browser-qa invalid-original',
    'codex-content-booking-v2-browser-qa',
    'codex-content-booking-v2-browser-qa',
    invalid_source.media_path,
    invalid_source.invalid_service_id,
    invalid_source.staff_id,
    'published',
    now(),
    true
  from invalid_source, guard
  returning id, organization_id, salon_id, service_id, recommended_staff_id
),
inserted_update as (
  insert into public.salon_profile_updates (
    organization_id,
    salon_id,
    update_type,
    title,
    caption,
    summary,
    media_path,
    status,
    published_at
  )
  select
    update_source.organization_id,
    update_source.salon_id,
    'announcement',
    'Codex V2 QA Inspiration Update',
    'codex-content-booking-v2-browser-qa inspiration-only',
    'codex-content-booking-v2-browser-qa',
    update_source.media_path,
    'published',
    now()
  from update_source, guard
  returning id, organization_id, salon_id
),
look_config as (
  insert into public.salon_profile_content_booking_configs (
    organization_id,
    salon_id,
    source_type,
    look_id,
    booking_cta_enabled,
    primary_service_id,
    credited_staff_id,
    booking_note
  )
  select
    inserted_look.organization_id,
    inserted_look.salon_id,
    'salon_profile_look',
    inserted_look.id,
    true,
    inserted_look.service_id,
    inserted_look.recommended_staff_id,
    'codex-content-booking-v2-browser-qa'
  from inserted_look
  returning id
),
invalid_config as (
  insert into public.salon_profile_content_booking_configs (
    organization_id,
    salon_id,
    source_type,
    look_id,
    booking_cta_enabled,
    primary_service_id,
    credited_staff_id,
    booking_note
  )
  select
    inserted_invalid_look.organization_id,
    inserted_invalid_look.salon_id,
    'salon_profile_look',
    inserted_invalid_look.id,
    true,
    inserted_invalid_look.service_id,
    inserted_invalid_look.recommended_staff_id,
    'codex-content-booking-v2-browser-qa'
  from inserted_invalid_look
  returning id
),
update_config as (
  insert into public.salon_profile_content_booking_configs (
    organization_id,
    salon_id,
    source_type,
    update_id,
    booking_cta_enabled
  )
  select
    inserted_update.organization_id,
    inserted_update.salon_id,
    'salon_profile_update',
    inserted_update.id,
    true
  from inserted_update
  returning id
)
select
  inserted_look.id as quick_look_id,
  inserted_look.salon_id as quick_salon_id,
  inserted_look.service_id as quick_service_id,
  inserted_look.recommended_staff_id as quick_staff_id,
  look_source.service_name as quick_service_name,
  look_source.staff_name as quick_staff_name,
  '/book/' || inserted_look.salon_id::text || '?source=explore&inspiration=' || inserted_look.id::text
    as quick_booking_href,
  inserted_invalid_look.id as invalid_look_id,
  inserted_invalid_look.salon_id as invalid_salon_id,
  invalid_source.invalid_service_id,
  invalid_source.invalid_service_name,
  '/book/' || inserted_invalid_look.salon_id::text || '?source=explore&inspiration=' || inserted_invalid_look.id::text
    as invalid_booking_href,
  inserted_update.id as update_id,
  inserted_update.salon_id as update_salon_id,
  '/book/' || inserted_update.salon_id::text || '?source=explore&inspiration=' || inserted_update.id::text
    as update_booking_href,
  (select count(*) from availability_rules) as availability_rule_count,
  (select id from look_config) as quick_config_id,
  (select id from invalid_config) as invalid_config_id,
  (select id from update_config) as update_config_id
from inserted_look
join look_source on true
join inserted_invalid_look on true
join invalid_source on true
join inserted_update on true;
