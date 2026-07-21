with marked_bookings as (
  select bookings.id, bookings.customer_id
  from public.bookings bookings
  where bookings.idempotency_key like 'codex-content-booking-v2-browser-qa%'
     or bookings.public_notes like 'codex-content-booking-v2-browser-qa%'
     or bookings.notes like 'codex-content-booking-v2-browser-qa%'
),
cancelled_bookings as (
  update public.bookings bookings
  set
    status = 'cancelled',
    cancellation_reason = coalesce(
      nullif(btrim(bookings.cancellation_reason), ''),
      'Codex Q8 fixture cleanup'
    ),
    cancelled_at = coalesce(bookings.cancelled_at, now()),
    updated_at = now()
  from marked_bookings
  where bookings.id = marked_bookings.id
    and bookings.status <> 'cancelled'
  returning bookings.id
),
marked_customers as (
  select distinct customers.id
  from public.customers customers
  left join marked_bookings on marked_bookings.customer_id = customers.id
  where marked_bookings.customer_id is not null
     or customers.email like 'codex-content-v2-browser-%@example.invalid'
     or customers.email like 'codex-content-v2-browser-%@example.com'
     or customers.notes like 'codex-content-booking-v2-browser-qa%'
),
cleaned_customers as (
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
  from marked_customers
  where customers.id = marked_customers.id
  returning customers.id
)
delete from public.booking_inspirations inspirations
where inspirations.source_title_snapshot in (
  'Codex V2 QA Quick Ready Look',
  'Codex V2 QA Invalid Original Look',
  'Codex V2 QA Inspiration Update'
);

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
   or users.email like 'codex-content-v2-browser-%@example.com';

delete from auth.users users
where users.email like 'codex-content-v2-browser-%@example.invalid'
   or users.email like 'codex-content-v2-browser-%@example.com';

delete from public.staff_availability_rules rules
where rules.starts_at_local = '08:07:00'::time
  and rules.ends_at_local = '19:07:00'::time
  and rules.effective_start_date = current_date
  and rules.effective_end_date = current_date + 45;

delete from public.salon_profile_looks looks
where looks.booking_note = 'codex-content-booking-v2-browser-qa';

delete from public.salon_profile_updates updates
where updates.summary = 'codex-content-booking-v2-browser-qa'
   or updates.caption = 'codex-content-booking-v2-browser-qa';

select
  (
    select count(*)
    from public.salon_profile_looks looks
    where looks.booking_note = 'codex-content-booking-v2-browser-qa'
  ) as remaining_browser_look_fixtures,
  (
    select count(*)
    from public.salon_profile_updates updates
    where updates.summary = 'codex-content-booking-v2-browser-qa'
       or updates.caption = 'codex-content-booking-v2-browser-qa'
  ) as remaining_browser_update_fixtures,
  (
    select count(*)
    from public.booking_inspirations inspirations
    where inspirations.source_title_snapshot in (
      'Codex V2 QA Quick Ready Look',
      'Codex V2 QA Invalid Original Look',
      'Codex V2 QA Inspiration Update'
    )
  ) as remaining_browser_inspiration_fixtures,
  (
    select count(*)
    from public.bookings bookings
    where (
      bookings.idempotency_key like 'codex-content-booking-v2-browser-qa%'
      or bookings.public_notes like 'codex-content-booking-v2-browser-qa%'
      or bookings.notes like 'codex-content-booking-v2-browser-qa%'
    )
      and bookings.status <> 'cancelled'
  ) as remaining_browser_active_booking_fixtures,
  (
    select count(*)
    from public.customers customers
    where (
      customers.email like 'codex-content-v2-browser-%@example.invalid'
      or customers.email like 'codex-content-v2-browser-%@example.com'
      or customers.notes like 'codex-content-booking-v2-browser-qa%'
    )
      and customers.status <> 'inactive'
  ) as remaining_browser_active_customer_fixtures,
  (
    select count(*)
    from public.users users
    where users.email like 'codex-content-v2-browser-%@example.invalid'
       or users.email like 'codex-content-v2-browser-%@example.com'
  ) as remaining_browser_public_user_fixtures,
  (
    select count(*)
    from auth.users users
    where users.email like 'codex-content-v2-browser-%@example.invalid'
       or users.email like 'codex-content-v2-browser-%@example.com'
  ) as remaining_browser_auth_user_fixtures,
  (
    select count(*)
    from public.staff_availability_rules rules
    where rules.starts_at_local = '08:07:00'::time
      and rules.ends_at_local = '19:07:00'::time
      and rules.effective_start_date = current_date
      and rules.effective_end_date = current_date + 45
  ) as remaining_browser_availability_fixtures;
