begin;

create or replace function pg_temp.qa_assert(check_name text, ok boolean)
returns void
language plpgsql
as $$
begin
  if coalesce(ok, false) is not true then
    raise exception 'QA assertion failed: %', check_name;
  end if;
end;
$$;

select set_config('qa.marker', 'codex-content-booking-v2-qa', true);
select set_config('qa.poster_auth_id', gen_random_uuid()::text, true);
select set_config('qa.customer_auth_id', gen_random_uuid()::text, true);
select set_config('qa.staff_id', gen_random_uuid()::text, true);
select set_config('qa.look_id', gen_random_uuid()::text, true);
select set_config('qa.update_id', gen_random_uuid()::text, true);
select set_config('qa.private_update_id', gen_random_uuid()::text, true);
select set_config('qa.cross_update_id', gen_random_uuid()::text, true);
select set_config('qa.missing_update_id', gen_random_uuid()::text, true);
select set_config('qa.media_asset_id', gen_random_uuid()::text, true);
select set_config('qa.customer_id', gen_random_uuid()::text, true);
select set_config('qa.booking_id', gen_random_uuid()::text, true);
select set_config('qa.line_id', gen_random_uuid()::text, true);
select set_config('qa.raw_token', repeat('b', 64), true);

create temp table qa_source on commit drop as
select
  locations.organization_id,
  locations.id as salon_id,
  services.id as service_id,
  services.name as service_name,
  services.duration_minutes as service_duration_minutes,
  coalesce(settings.business_name, locations.name) as salon_name
from public.locations
join public.salon_settings settings
  on settings.organization_id = locations.organization_id
  and settings.salon_id = locations.id
join public.booking_settings booking_settings
  on booking_settings.organization_id = locations.organization_id
  and booking_settings.salon_id = locations.id
  and booking_settings.booking_enabled = true
  and booking_settings.online_booking_visible = true
join public.services
  on services.organization_id = locations.organization_id
  and services.salon_id = locations.id
  and services.is_active = true
  and services.online_booking_enabled = true
where locations.status = 'active'
  and public.salon_profile_public_salon_exists(locations.id)
  and not exists (
    select 1
    from public.service_add_on_links add_on_links
    where add_on_links.salon_id = services.salon_id
      and add_on_links.add_on_service_id = services.id
      and add_on_links.is_active = true
  )
order by locations.created_at desc, services.name
limit 1;

grant select on qa_source to authenticated;

select pg_temp.qa_assert(
  'qa_source_available',
  exists (select 1 from qa_source)
);

select set_config(
  'qa.media_path',
  (
    select salon_id::text || '/updates/' || current_setting('qa.update_id') || '.jpg'
    from qa_source
  ),
  true
);
select set_config(
  'qa.guest_start_at',
  (((current_date + 14)::timestamp + time '10:00') at time zone 'America/Chicago')::text,
  true
);
select set_config(
  'qa.auth_start_at',
  (((current_date + 15)::timestamp + time '10:00') at time zone 'America/Chicago')::text,
  true
);
select set_config(
  'qa.guest_end_at',
  (
    select (
      current_setting('qa.guest_start_at')::timestamptz
      + make_interval(mins => service_duration_minutes)
    )::text
    from qa_source
  ),
  true
);
select set_config(
  'qa.auth_end_at',
  (
    select (
      current_setting('qa.auth_start_at')::timestamptz
      + make_interval(mins => service_duration_minutes)
    )::text
    from qa_source
  ),
  true
);

create temp table qa_cross_salon on commit drop as
select
  locations.organization_id,
  locations.id as salon_id
from public.locations
where locations.status = 'active'
  and locations.id <> (select salon_id from qa_source)
order by locations.created_at desc
limit 1;

select pg_temp.qa_assert(
  'qa_cross_salon_available',
  exists (select 1 from qa_cross_salon)
);

insert into auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  is_sso_user,
  is_anonymous
)
values
  (
    current_setting('qa.poster_auth_id')::uuid,
    'authenticated',
    'authenticated',
    'codex-content-v2-poster-' || left(current_setting('qa.poster_auth_id'), 8) || '@example.invalid',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Codex V2 Poster"}'::jsonb,
    now(),
    now(),
    false,
    false
  ),
  (
    current_setting('qa.customer_auth_id')::uuid,
    'authenticated',
    'authenticated',
    'codex-content-v2-customer-' || left(current_setting('qa.customer_auth_id'), 8) || '@example.invalid',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Codex V2 Customer"}'::jsonb,
    now(),
    now(),
    false,
    false
  );

select set_config('qa.poster_user_id', users.id::text, true)
from public.users
where users.auth_user_id = current_setting('qa.poster_auth_id')::uuid;

select set_config('qa.customer_user_id', users.id::text, true)
from public.users
where users.auth_user_id = current_setting('qa.customer_auth_id')::uuid;

insert into public.staff (
  id,
  organization_id,
  salon_id,
  user_id,
  account_user_id,
  display_name,
  email,
  job_title,
  is_active,
  online_booking_enabled,
  owner_public_enabled,
  public_profile_visible,
  staff_public_consent_status,
  salon_profile_content_posting_enabled
)
select
  current_setting('qa.staff_id')::uuid,
  organization_id,
  salon_id,
  current_setting('qa.poster_auth_id')::uuid,
  current_setting('qa.poster_user_id')::uuid,
  'Codex V2 Content Professional',
  'codex-content-v2-professional@example.invalid',
  'QA professional',
  true,
  true,
  true,
  true,
  'granted',
  true
from qa_source;

insert into public.staff_service_assignments (
  organization_id,
  salon_id,
  staff_id,
  service_id,
  is_active,
  online_bookable
)
select
  organization_id,
  salon_id,
  current_setting('qa.staff_id')::uuid,
  service_id,
  true,
  true
from qa_source;

update public.booking_settings booking_settings
set
  booking_enabled = true,
  online_booking_visible = true,
  confirmation_mode = 'instant_booking',
  minimum_lead_time_minutes = 0,
  maximum_advance_window_days = 365,
  same_day_booking_enabled = true,
  any_professional_enabled = true,
  guest_booking_enabled = true,
  timezone_iana = 'America/Chicago',
  updated_at = now()
from qa_source
where booking_settings.organization_id = qa_source.organization_id
  and booking_settings.salon_id = qa_source.salon_id;

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
  qa_source.organization_id,
  qa_source.salon_id,
  current_setting('qa.staff_id')::uuid,
  'working',
  extract(dow from slots.slot_start at time zone 'America/Chicago')::integer,
  '08:00:00'::time,
  '19:00:00'::time,
  'America/Chicago',
  (slots.slot_start at time zone 'America/Chicago')::date,
  (slots.slot_start at time zone 'America/Chicago')::date,
  true
from qa_source
cross join (
  values
    (current_setting('qa.guest_start_at')::timestamptz),
    (current_setting('qa.auth_start_at')::timestamptz)
) as slots(slot_start);

insert into public.salon_profile_media_assets (
  id,
  organization_id,
  salon_id,
  uploaded_by_user_id,
  bucket,
  object_path,
  purpose,
  mime_type,
  original_bytes,
  processed_bytes,
  width,
  height,
  status,
  attached_entity_type,
  attached_entity_id,
  upload_intent,
  expires_at,
  attached_at
)
select
  current_setting('qa.media_asset_id')::uuid,
  organization_id,
  salon_id,
  current_setting('qa.poster_user_id')::uuid,
  'salon-profile-media',
  current_setting('qa.media_path'),
  'update',
  'image/jpeg',
  128,
  96,
  64,
  64,
  'active',
  'salon_profile_update',
  current_setting('qa.update_id')::uuid,
  'content',
  now() + interval '7 days',
  now()
from qa_source;

insert into public.salon_profile_looks (
  id,
  organization_id,
  salon_id,
  author_user_id,
  author_staff_id,
  created_by_user_id,
  title,
  caption,
  emotional_description,
  media_path,
  status,
  published_at
)
select
  current_setting('qa.look_id')::uuid,
  organization_id,
  salon_id,
  current_setting('qa.poster_user_id')::uuid,
  current_setting('qa.staff_id')::uuid,
  current_setting('qa.poster_user_id')::uuid,
  'Codex V2 Quick Ready Look',
  'codex-content-booking-v2-qa #quickready',
  'codex-content-booking-v2-qa',
  null,
  'published',
  now()
from qa_source;

insert into public.salon_profile_updates (
  id,
  organization_id,
  salon_id,
  author_user_id,
  author_staff_id,
  created_by_user_id,
  update_type,
  title,
  caption,
  summary,
  media_path,
  status,
  published_at
)
select
  current_setting('qa.update_id')::uuid,
  organization_id,
  salon_id,
  current_setting('qa.poster_user_id')::uuid,
  current_setting('qa.staff_id')::uuid,
  current_setting('qa.poster_user_id')::uuid,
  'announcement',
  'Codex V2 Inspiration Only Update',
  'codex-content-booking-v2-qa #nomap',
  'codex-content-booking-v2-qa',
  current_setting('qa.media_path'),
  'published',
  now()
from qa_source;

insert into public.salon_profile_updates (
  id,
  organization_id,
  salon_id,
  update_type,
  title,
  caption,
  summary,
  status,
  published_at
)
select
  current_setting('qa.private_update_id')::uuid,
  organization_id,
  salon_id,
  'announcement',
  'Codex V2 Private Update',
  'codex-content-booking-v2-qa #private',
  'codex-content-booking-v2-qa',
  'draft',
  null
from qa_source;

insert into public.salon_profile_updates (
  id,
  organization_id,
  salon_id,
  update_type,
  title,
  caption,
  summary,
  status,
  published_at
)
select
  current_setting('qa.cross_update_id')::uuid,
  organization_id,
  salon_id,
  'announcement',
  'Codex V2 Cross Salon Update',
  'codex-content-booking-v2-qa #cross',
  'codex-content-booking-v2-qa',
  'published',
  now()
from qa_cross_salon;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('qa.poster_auth_id'), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select public.save_salon_profile_content_booking_config(
  'salon_profile_look',
  current_setting('qa.look_id')::uuid,
  true,
  (select service_id from qa_source),
  current_setting('qa.staff_id')::uuid,
  '{}'::uuid[],
  'codex-content-booking-v2-qa booking note'
) as saved_look_config_id;

select public.save_salon_profile_content_booking_config(
  'salon_profile_update',
  current_setting('qa.update_id')::uuid,
  true,
  null,
  null,
  '{}'::uuid[],
  null
) as saved_update_config_id;

reset role;

create temp table qa_options on commit drop as
select *
from public.get_public_content_booking_options(
  array[(select salon_id from qa_source)]::uuid[]
)
where content_id in (
  current_setting('qa.look_id')::uuid,
  current_setting('qa.update_id')::uuid
);

select pg_temp.qa_assert(
  'quick_ready_option_ok',
  exists (
  select 1
  from qa_options
  where content_id = current_setting('qa.look_id')::uuid
    and source_type = 'salon_profile_look'
    and content_type = 'look'
    and booking_enabled = true
    and booking_href is not null
    and cta_label = 'Book this look'
    and readiness_state = 'quick_ready'
    and primary_service_id = (select service_id from qa_source)
    and credited_staff_id = current_setting('qa.staff_id')::uuid
  )
);

select pg_temp.qa_assert(
  'update_inspiration_only_ok',
  exists (
  select 1
  from qa_options
  where content_id = current_setting('qa.update_id')::uuid
    and source_type = 'salon_profile_update'
    and content_type = 'update'
    and booking_enabled = true
    and booking_href is not null
    and cta_label = 'Book with this inspiration'
    and readiness_state = 'inspiration_only'
    and primary_service_id is null
    and credited_staff_id is null
  )
);

select set_config(
  'qa.guest_rpc_payload',
  (
    select public.create_public_booking(
      qa_source.salon_id,
      current_setting('qa.guest_start_at')::timestamptz,
      current_setting('qa.guest_end_at')::timestamptz,
      'Codex',
      'Guest',
      '5552220101',
      'codex-content-booking-v2-guest@example.invalid',
      current_setting('qa.marker') || ' guest update booking',
      current_setting('qa.marker') || '-guest-update',
      'explore',
      'salon_profile_update',
      current_setting('qa.update_id')::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'service_id', qa_source.service_id,
          'assigned_staff_id', current_setting('qa.staff_id')::uuid,
          'scheduled_start_at', current_setting('qa.guest_start_at')::timestamptz,
          'scheduled_end_at', current_setting('qa.guest_end_at')::timestamptz,
          'cleanup_buffer_minutes', 0,
          'line_type', 'service',
          'display_order', 0
        )
      )
    )::text
    from qa_source
  ),
  true
);

select set_config(
  'qa.guest_booking_id',
  current_setting('qa.guest_rpc_payload')::jsonb ->> 'booking_id',
  true
);

select pg_temp.qa_assert(
  'guest_update_rpc_booking_ok',
  (current_setting('qa.guest_rpc_payload')::jsonb ->> 'ok')::boolean
    and current_setting('qa.guest_rpc_payload')::jsonb ->> 'manage_token' is not null
);

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('qa.customer_auth_id'), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'qa.auth_rpc_payload',
  (
    select public.create_public_booking(
      qa_source.salon_id,
      current_setting('qa.auth_start_at')::timestamptz,
      current_setting('qa.auth_end_at')::timestamptz,
      'Codex',
      'Auth',
      '5552220102',
      'codex-content-booking-v2-auth@example.invalid',
      current_setting('qa.marker') || ' auth update booking',
      current_setting('qa.marker') || '-auth-update',
      'explore',
      'salon_profile_update',
      current_setting('qa.update_id')::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'service_id', qa_source.service_id,
          'assigned_staff_id', current_setting('qa.staff_id')::uuid,
          'scheduled_start_at', current_setting('qa.auth_start_at')::timestamptz,
          'scheduled_end_at', current_setting('qa.auth_end_at')::timestamptz,
          'cleanup_buffer_minutes', 0,
          'line_type', 'service',
          'display_order', 0
        )
      )
    )::text
    from qa_source
  ),
  true
);
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

select set_config(
  'qa.auth_booking_id',
  current_setting('qa.auth_rpc_payload')::jsonb ->> 'booking_id',
  true
);

select pg_temp.qa_assert(
  'auth_update_rpc_booking_ok',
  (current_setting('qa.auth_rpc_payload')::jsonb ->> 'ok')::boolean
    and exists (
      select 1
      from public.bookings bookings
      where bookings.id = (current_setting('qa.auth_rpc_payload')::jsonb ->> 'booking_id')::uuid
        and bookings.customer_user_id = current_setting('qa.customer_user_id')::uuid
    )
);

select pg_temp.qa_assert(
  'guest_update_snapshot_ok',
  exists (
  select 1
  from public.booking_inspirations inspirations
  where inspirations.booking_id = current_setting('qa.guest_booking_id')::uuid
    and inspirations.source_type = 'salon_profile_update'
    and inspirations.source_content_id = current_setting('qa.update_id')::uuid
    and inspirations.source_title_snapshot = 'Codex V2 Inspiration Only Update'
    and inspirations.source_caption_snapshot = 'codex-content-booking-v2-qa #nomap'
    and inspirations.source_media_asset_id = current_setting('qa.media_asset_id')::uuid
    and inspirations.source_media_path = current_setting('qa.media_path')
    and inspirations.source_media_width = 64
    and inspirations.source_media_height = 64
    and inspirations.service_id is null
    and inspirations.credited_staff_id is null
    and jsonb_array_length(inspirations.metadata -> 'final_booking_lines') = 1
    and (
      inspirations.metadata -> 'final_booking_lines' -> 0 ->> 'service_id'
    )::uuid = (select service_id from qa_source)
    and (
      inspirations.metadata -> 'final_booking_lines' -> 0 ->> 'assigned_staff_id'
    )::uuid = current_setting('qa.staff_id')::uuid
  )
);

select pg_temp.qa_assert(
  'auth_update_snapshot_ok',
  exists (
  select 1
  from public.booking_inspirations inspirations
  where inspirations.booking_id = current_setting('qa.auth_booking_id')::uuid
    and inspirations.source_type = 'salon_profile_update'
    and inspirations.source_content_id = current_setting('qa.update_id')::uuid
    and inspirations.source_title_snapshot = 'Codex V2 Inspiration Only Update'
    and jsonb_array_length(inspirations.metadata -> 'final_booking_lines') = 1
  )
);

do $$
begin
  perform public.create_public_booking(
    qa_source.salon_id,
    current_setting('qa.guest_start_at')::timestamptz + interval '3 days',
    current_setting('qa.guest_end_at')::timestamptz + interval '3 days',
    'Codex',
    'Private',
    '5552220103',
    'codex-content-booking-v2-private@example.invalid',
    current_setting('qa.marker') || ' private update booking',
    current_setting('qa.marker') || '-private-update',
    'explore',
    'salon_profile_update',
    current_setting('qa.private_update_id')::uuid,
    jsonb_build_array(
      jsonb_build_object(
        'service_id', qa_source.service_id,
        'assigned_staff_id', current_setting('qa.staff_id')::uuid,
        'scheduled_start_at', current_setting('qa.guest_start_at')::timestamptz + interval '3 days',
        'scheduled_end_at', current_setting('qa.guest_end_at')::timestamptz + interval '3 days',
        'cleanup_buffer_minutes', 0,
        'line_type', 'service',
        'display_order', 0
      )
    )
  )
  from qa_source;

  raise exception 'Expected private update booking to be rejected.';
exception
  when others then
    if sqlerrm <> 'Booking source context is not available.' then
      raise exception 'Private update rejection changed: %', sqlerrm;
    end if;
end;
$$;

do $$
begin
  perform public.create_public_booking(
    qa_source.salon_id,
    current_setting('qa.guest_start_at')::timestamptz + interval '4 days',
    current_setting('qa.guest_end_at')::timestamptz + interval '4 days',
    'Codex',
    'Cross',
    '5552220104',
    'codex-content-booking-v2-cross@example.invalid',
    current_setting('qa.marker') || ' cross update booking',
    current_setting('qa.marker') || '-cross-update',
    'explore',
    'salon_profile_update',
    current_setting('qa.cross_update_id')::uuid,
    jsonb_build_array(
      jsonb_build_object(
        'service_id', qa_source.service_id,
        'assigned_staff_id', current_setting('qa.staff_id')::uuid,
        'scheduled_start_at', current_setting('qa.guest_start_at')::timestamptz + interval '4 days',
        'scheduled_end_at', current_setting('qa.guest_end_at')::timestamptz + interval '4 days',
        'cleanup_buffer_minutes', 0,
        'line_type', 'service',
        'display_order', 0
      )
    )
  )
  from qa_source;

  raise exception 'Expected cross-salon update booking to be rejected.';
exception
  when others then
    if sqlerrm <> 'Booking source context is not available.' then
      raise exception 'Cross-salon update rejection changed: %', sqlerrm;
    end if;
end;
$$;

do $$
begin
  perform public.create_public_booking(
    qa_source.salon_id,
    current_setting('qa.guest_start_at')::timestamptz + interval '5 days',
    current_setting('qa.guest_end_at')::timestamptz + interval '5 days',
    'Codex',
    'Missing',
    '5552220105',
    'codex-content-booking-v2-missing@example.invalid',
    current_setting('qa.marker') || ' missing update booking',
    current_setting('qa.marker') || '-missing-update',
    'explore',
    'salon_profile_update',
    current_setting('qa.missing_update_id')::uuid,
    jsonb_build_array(
      jsonb_build_object(
        'service_id', qa_source.service_id,
        'assigned_staff_id', current_setting('qa.staff_id')::uuid,
        'scheduled_start_at', current_setting('qa.guest_start_at')::timestamptz + interval '5 days',
        'scheduled_end_at', current_setting('qa.guest_end_at')::timestamptz + interval '5 days',
        'cleanup_buffer_minutes', 0,
        'line_type', 'service',
        'display_order', 0
      )
    )
  )
  from qa_source;

  raise exception 'Expected missing update booking to be rejected.';
exception
  when others then
    if sqlerrm <> 'Booking source context is not available.' then
      raise exception 'Missing update rejection changed: %', sqlerrm;
    end if;
end;
$$;

update public.salon_profile_updates
set
  status = 'draft',
  title = 'Codex V2 Mutated Update',
  caption = 'codex-content-booking-v2-qa mutated',
  media_path = null,
  updated_at = now()
where id = current_setting('qa.update_id')::uuid;

select pg_temp.qa_assert(
  'update_snapshot_retained_after_unpublish_ok',
  exists (
  select 1
  from public.booking_inspirations inspirations
  where inspirations.booking_id = current_setting('qa.guest_booking_id')::uuid
    and inspirations.source_type = 'salon_profile_update'
    and inspirations.source_title_snapshot = 'Codex V2 Inspiration Only Update'
    and inspirations.source_caption_snapshot = 'codex-content-booking-v2-qa #nomap'
    and inspirations.source_media_path = current_setting('qa.media_path')
  )
);

select pg_temp.qa_assert(
  'anon_config_direct_select_denied',
  not has_table_privilege(
    'anon',
    'public.salon_profile_content_booking_configs',
    'select'
  )
);

select pg_temp.qa_assert(
  'public_options_removed_after_unpublish_ok',
  not exists (
  select 1
  from public.get_public_content_booking_options(
    array[(select salon_id from qa_source)]::uuid[]
  )
  where content_id = current_setting('qa.update_id')::uuid
  )
);

rollback;

select
  'content_booking_v2_hosted_verification_passed' as result,
  (
    select count(*)
    from auth.users
    where email like 'codex-content-v2-%@example.invalid'
  ) as remaining_auth_fixtures,
  (
    select count(*)
    from public.salon_profile_looks
    where title = 'Codex V2 Quick Ready Look'
  ) as remaining_look_fixtures,
  (
    select count(*)
    from public.salon_profile_updates
    where title = 'Codex V2 Inspiration Only Update'
  ) as remaining_update_fixtures,
  (
    select count(*)
    from public.bookings
    where idempotency_key like 'codex-content-booking-v2-qa%'
  ) as remaining_booking_fixtures;
