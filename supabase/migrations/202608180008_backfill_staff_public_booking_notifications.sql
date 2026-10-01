insert into public.app_notifications (
  account_id,
  salon_id,
  recipient_user_id,
  recipient_kind,
  notification_type,
  booking_id,
  title,
  body,
  href,
  event_key,
  created_at,
  updated_at
)
select
  booking_notice.account_id,
  booking_notice.salon_id,
  staff_recipients.recipient_user_id,
  'staff',
  'public_booking_created',
  booking_notice.id,
  case
    when booking_notice.status = 'pending'
      or booking_notice.confirmation_status = 'requested'
    then 'New booking request'
    else 'New booking confirmed'
  end,
  booking_notice.customer_name || ' booked with you at ' || booking_notice.salon_name || '.',
  '/staff/appointments?date=' || booking_notice.booking_local_date || '&bookingId=' || booking_notice.id::text,
  'public_booking_created_staff:' || booking_notice.id::text || ':' || staff_recipients.recipient_user_id::text,
  booking_notice.first_owner_notification_at,
  now()
from (
  select
    bookings.id,
    bookings.salon_id,
    bookings.status,
    bookings.confirmation_status,
    salons.account_id,
    to_char(
      bookings.start_at at time zone coalesce(
        nullif(bookings.salon_timezone_snapshot, ''),
        'America/Chicago'
      ),
      'YYYY-MM-DD'
    ) as booking_local_date,
    coalesce(nullif(btrim(settings.business_name), ''), salons.name, 'this salon') as salon_name,
    coalesce(nullif(btrim(customers.name), ''), 'A customer') as customer_name,
    min(owner_notifications.created_at) as first_owner_notification_at
  from public.app_notifications owner_notifications
  join public.bookings bookings
    on bookings.id = owner_notifications.booking_id
  join public.locations salons
    on salons.id = bookings.salon_id
  join public.customers customers
    on customers.id = bookings.customer_id
  left join public.salon_settings settings
    on settings.salon_id = bookings.salon_id
  where owner_notifications.notification_type = 'public_booking_created'
    and owner_notifications.recipient_kind = 'owner_manager'
    and owner_notifications.event_key like 'public_booking_created:' || bookings.id::text || ':%'
  group by
    bookings.id,
    bookings.salon_id,
    bookings.status,
    bookings.confirmation_status,
    bookings.start_at,
    bookings.salon_timezone_snapshot,
    salons.account_id,
    salons.name,
    settings.business_name,
    customers.name
) booking_notice
join lateral (
  select distinct
    coalesce(staff.account_user_id, staff.user_id) as recipient_user_id
  from public.booking_lines booking_lines
  join public.staff staff
    on staff.id = booking_lines.assigned_staff_id
  where booking_lines.booking_id = booking_notice.id
    and booking_lines.salon_id = booking_notice.salon_id
    and staff.is_active = true
    and coalesce(staff.account_user_id, staff.user_id) is not null
) staff_recipients on true
on conflict (recipient_user_id, event_key) where event_key is not null do nothing;
