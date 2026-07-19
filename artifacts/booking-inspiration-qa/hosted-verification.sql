begin;

select set_config('qa.raw_token', repeat('a', 64), true);
select set_config('qa.customer_auth_id', gen_random_uuid()::text, true);
select set_config('qa.staff_auth_id', gen_random_uuid()::text, true);
select set_config('qa.other_auth_id', gen_random_uuid()::text, true);
select set_config('qa.customer_id', gen_random_uuid()::text, true);
select set_config('qa.staff_id', gen_random_uuid()::text, true);
select set_config('qa.booking_id', gen_random_uuid()::text, true);
select set_config('qa.line_id', gen_random_uuid()::text, true);

create temp table qa_source on commit drop as
select
  looks.id as look_id,
  looks.organization_id,
  looks.salon_id,
  services.id as service_id,
  looks.recommended_staff_id,
  coalesce(nullif(btrim(services.name), ''), 'QA service') as service_name,
  coalesce(nullif(btrim(settings.business_name), ''), locations.name) as salon_name
from public.salon_profile_looks looks
join public.locations locations
  on locations.id = looks.salon_id
  and locations.organization_id = looks.organization_id
  and locations.status = 'active'
join public.salon_settings settings
  on settings.salon_id = looks.salon_id
  and settings.organization_id = looks.organization_id
join public.booking_settings booking_settings
  on booking_settings.salon_id = looks.salon_id
  and booking_settings.organization_id = looks.organization_id
  and booking_settings.booking_enabled = true
  and booking_settings.online_booking_visible = true
left join public.salon_profile_media_assets assets
  on assets.bucket = 'salon-profile-media'
  and assets.object_path = looks.media_path
  and assets.organization_id = looks.organization_id
  and assets.salon_id = looks.salon_id
join storage.objects storage_objects
  on storage_objects.bucket_id = coalesce(assets.bucket, 'salon-profile-media')
  and storage_objects.name = looks.media_path
join lateral (
  select
    services.id,
    services.name
  from public.services services
  where services.salon_id = looks.salon_id
    and services.organization_id = looks.organization_id
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
  order by services.name
  limit 1
) services on true
where looks.status = 'published'
  and looks.media_path is not null
  and public.salon_profile_public_salon_exists(looks.salon_id)
  and (
    assets.id is null
    or (
      assets.status = 'active'
      and assets.deleted_at is null
      and assets.quarantined_at is null
    )
  )
order by coalesce(looks.published_at, looks.created_at) desc
limit 1;

select 1 / case when exists (select 1 from qa_source) then 1 else 0 end
  as source_eligible_look_ok;

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
    current_setting('qa.customer_auth_id')::uuid,
    'authenticated',
    'authenticated',
    'codex+' || left(current_setting('qa.customer_auth_id'), 8) || '@example.invalid',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Codex QA Customer"}'::jsonb,
    now(),
    now(),
    false,
    false
  ),
  (
    current_setting('qa.staff_auth_id')::uuid,
    'authenticated',
    'authenticated',
    'codex+' || left(current_setting('qa.staff_auth_id'), 8) || '@example.invalid',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Codex QA Staff"}'::jsonb,
    now(),
    now(),
    false,
    false
  ),
  (
    current_setting('qa.other_auth_id')::uuid,
    'authenticated',
    'authenticated',
    'codex+' || left(current_setting('qa.other_auth_id'), 8) || '@example.invalid',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Codex QA Other"}'::jsonb,
    now(),
    now(),
    false,
    false
  );

select set_config('qa.customer_user_id', users.id::text, true)
from public.users
where users.auth_user_id = current_setting('qa.customer_auth_id')::uuid;

select set_config('qa.staff_user_id', users.id::text, true)
from public.users
where users.auth_user_id = current_setting('qa.staff_auth_id')::uuid;

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
  'Codex QA Inspiration Customer',
  '5550000000',
  'codex-booking-inspiration@example.invalid',
  'codex-booking-inspiration-qa',
  'active'
from qa_source;

insert into public.staff (
  id,
  organization_id,
  salon_id,
  user_id,
  account_user_id,
  display_name,
  email,
  job_title,
  is_active
)
select
  current_setting('qa.staff_id')::uuid,
  organization_id,
  salon_id,
  current_setting('qa.staff_auth_id')::uuid,
  current_setting('qa.staff_user_id')::uuid,
  'Codex QA Inspiration Staff',
  'codex-booking-inspiration-staff@example.invalid',
  'QA professional',
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

update public.salon_profile_looks looks
set
  service_id = source.service_id,
  recommended_staff_id = current_setting('qa.staff_id')::uuid,
  updated_at = now()
from qa_source source
where looks.id = source.look_id;

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
  now() + interval '30 days',
  now() + interval '30 days 1 hour',
  'codex-booking-inspiration-qa',
  'codex-booking-inspiration-qa public note',
  'confirmed',
  'explore',
  'instant_booking',
  'confirmed',
  'America/Chicago',
  public.public_booking_token_hash(current_setting('qa.raw_token')),
  'salon_profile_look',
  look_id,
  'codex-booking-inspiration-qa',
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
  scheduled_end_at
)
select
  current_setting('qa.line_id')::uuid,
  organization_id,
  salon_id,
  current_setting('qa.booking_id')::uuid,
  'service',
  service_id,
  service_name,
  1,
  1,
  60,
  0,
  current_setting('qa.staff_id')::uuid,
  now() + interval '30 days',
  now() + interval '30 days 1 hour'
from qa_source;

select public.capture_booking_inspiration_snapshot(
  current_setting('qa.booking_id')::uuid,
  'salon_profile_look',
  (select look_id from qa_source)
);

select 1 / case when (
  select count(*)
  from public.booking_inspirations inspirations
  join qa_source source
    on source.look_id = inspirations.source_content_id
  where inspirations.booking_id = current_setting('qa.booking_id')::uuid
    and inspirations.source_type = 'salon_profile_look'
    and inspirations.source_salon_id = source.salon_id
    and inspirations.service_id = source.service_id
    and inspirations.booking_line_id = current_setting('qa.line_id')::uuid
) = 1 then 1 else 0 end as snapshot_created_ok;

select 1 / case when (
  public.get_public_booking_by_manage_token(current_setting('qa.raw_token'))
    -> 'inspiration' ->> 'source_content_id'
)::uuid = (select look_id from qa_source)
then 1 else 0 end as guest_manage_inspiration_ok;

select 1 / case when has_table_privilege(
  'anon',
  'public.booking_inspirations',
  'select'
) is false then 1 else 0 end as anon_direct_select_denied_ok;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('qa.customer_auth_id'), true);
select 1 / case when (
  select count(*)
  from public.booking_inspirations
  where booking_id = current_setting('qa.booking_id')::uuid
) = 1 then 1 else 0 end as linked_customer_rls_ok;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('qa.staff_auth_id'), true);
select 1 / case when (
  select count(*)
  from public.booking_inspirations
  where booking_id = current_setting('qa.booking_id')::uuid
) = 1 then 1 else 0 end as assigned_staff_rls_ok;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('qa.other_auth_id'), true);
select 1 / case when (
  select count(*)
  from public.booking_inspirations
  where booking_id = current_setting('qa.booking_id')::uuid
) = 0 then 1 else 0 end as other_customer_rejected_ok;
reset role;

select 1 / case when exists (
  select 1
  from public.get_public_explore_inspiration(null, null, 24) explore
  join qa_source source
    on source.look_id = explore.content_id
  where explore.content_type = 'look'
    and explore.booking_enabled = true
    and explore.booking_href =
      '/book/' || source.salon_id::text || '?source=explore&inspiration=' || source.look_id::text
) then 1 else 0 end as explore_booking_href_ok;

rollback;

select
  'booking_inspiration_hosted_verification_passed' as result,
  (
    select count(*)
    from public.customers
    where email = 'codex-booking-inspiration@example.invalid'
       or notes = 'codex-booking-inspiration-qa'
  ) as remaining_customer_fixtures,
  (
    select count(*)
    from public.bookings
    where idempotency_key = 'codex-booking-inspiration-qa'
       or notes = 'codex-booking-inspiration-qa'
  ) as remaining_booking_fixtures,
  (
    select count(*)
    from auth.users
    where email like 'codex+%@example.invalid'
  ) as remaining_auth_fixtures;
