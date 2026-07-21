begin;

select set_config('qa.marker', 'codex-content-booking-v2-qa', true);
select set_config('qa.poster_auth_id', gen_random_uuid()::text, true);
select set_config('qa.customer_auth_id', gen_random_uuid()::text, true);
select set_config('qa.staff_id', gen_random_uuid()::text, true);
select set_config('qa.look_id', gen_random_uuid()::text, true);
select set_config('qa.update_id', gen_random_uuid()::text, true);
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

select 1 / case when exists (select 1 from qa_source) then 1 else 0 end
  as qa_source_available;

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
  'published',
  now()
from qa_source;

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

select 1 / case when exists (
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
) then 1 else 0 end as quick_ready_option_ok;

select 1 / case when exists (
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
) then 1 else 0 end as update_inspiration_only_ok;

insert into public.customers (
  id,
  location_id,
  name,
  phone,
  email,
  notes,
  status
)
select
  current_setting('qa.customer_id')::uuid,
  salon_id,
  'Codex V2 Booking Customer',
  '5552220000',
  'codex-content-booking-v2-customer@example.invalid',
  current_setting('qa.marker'),
  'active'
from qa_source;

insert into public.bookings (
  id,
  organization_id,
  salon_id,
  customer_id,
  customer_user_id,
  staff_id,
  start_at,
  end_at,
  notes,
  public_notes,
  status,
  source,
  confirmation_mode,
  confirmation_status,
  salon_timezone_snapshot,
  customer_cancellation_token_hash,
  source_reference_type,
  source_reference_id,
  idempotency_key,
  payment_status,
  deposit_policy_snapshot,
  cancellation_policy_snapshot
)
select
  current_setting('qa.booking_id')::uuid,
  organization_id,
  salon_id,
  current_setting('qa.customer_id')::uuid,
  current_setting('qa.customer_user_id')::uuid,
  current_setting('qa.staff_id')::uuid,
  now() + interval '21 days',
  now() + interval '21 days 1 hour',
  current_setting('qa.marker'),
  current_setting('qa.marker'),
  'confirmed',
  'explore',
  'instant_booking',
  'confirmed',
  'America/Chicago',
  public.public_booking_token_hash(current_setting('qa.raw_token')),
  'salon_profile_update',
  current_setting('qa.update_id')::uuid,
  current_setting('qa.marker'),
  'not_required',
  '{}'::jsonb,
  '{}'::jsonb
from qa_source;

insert into public.booking_lines (
  id,
  organization_id,
  salon_id,
  booking_id,
  line_type,
  service_id,
  service_name_snapshot,
  unit_price,
  quantity,
  duration_minutes,
  display_order,
  assigned_staff_id,
  scheduled_start_at,
  scheduled_end_at,
  line_status
)
select
  current_setting('qa.line_id')::uuid,
  organization_id,
  salon_id,
  current_setting('qa.booking_id')::uuid,
  'service',
  service_id,
  service_name,
  10,
  1,
  30,
  0,
  current_setting('qa.staff_id')::uuid,
  now() + interval '21 days',
  now() + interval '21 days 30 minutes',
  'scheduled'
from qa_source;

select public.capture_booking_inspiration_snapshot(
  current_setting('qa.booking_id')::uuid,
  'salon_profile_update',
  current_setting('qa.update_id')::uuid
);

select 1 / case when exists (
  select 1
  from public.booking_inspirations inspirations
  where inspirations.booking_id = current_setting('qa.booking_id')::uuid
    and inspirations.source_type = 'salon_profile_update'
    and inspirations.source_content_id = current_setting('qa.update_id')::uuid
    and inspirations.source_title_snapshot = 'Codex V2 Inspiration Only Update'
    and jsonb_array_length(inspirations.metadata -> 'final_booking_lines') = 1
) then 1 else 0 end as update_snapshot_ok;

select 1 / case when not has_table_privilege(
  'anon',
  'public.salon_profile_content_booking_configs',
  'select'
) then 1 else 0 end as anon_config_direct_select_denied;

select 1 / case when exists (
  select 1
  from public.get_public_content_booking_options(
    array[(select salon_id from qa_source)]::uuid[]
  )
  where content_id = current_setting('qa.update_id')::uuid
) then 1 else 0 end as public_options_rpc_ok;

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
    where idempotency_key = 'codex-content-booking-v2-qa'
  ) as remaining_booking_fixtures;
