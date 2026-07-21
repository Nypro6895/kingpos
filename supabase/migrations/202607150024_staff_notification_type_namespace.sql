-- Staff notification type namespace repair.
-- Hybrid users can be both manager and linked staff. The notification uniqueness
-- key intentionally deduplicates per recipient/type/event, so staff notifications
-- need distinct type values from owner/customer notifications to keep staff
-- deep links from being suppressed.

create or replace function public.notify_booking_status_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assignment jsonb;
  booking_row public.bookings%rowtype;
  customer_title text;
  line_id uuid;
  owner_recipient record;
  staff_recipient record;
begin
  select *
  into booking_row
  from public.bookings
  where id = new.booking_id;

  if booking_row.id is null then
    return new;
  end if;

  line_id := nullif(new.metadata ->> 'booking_line_id', '')::uuid;

  for owner_recipient in
    select distinct organization_memberships.user_id
    from public.organization_memberships
    left join public.roles
      on roles.id = organization_memberships.role_id
    left join public.role_permissions
      on role_permissions.role_id = roles.id
    left join public.permissions
      on permissions.id = role_permissions.permission_id
    where organization_memberships.organization_id = new.organization_id
      and organization_memberships.status = 'active'
      and (
        organization_memberships.user_id = (
          select organizations.owner_user_id
          from public.organizations
          where organizations.id = new.organization_id
        )
        or permissions.code in ('booking.view', 'booking.manage')
      )
  loop
    if new.event_type in ('confirmation_requested', 'booking_created')
      and booking_row.source in ('public_profile', 'explore')
    then
      perform public.insert_app_notification(
        owner_recipient.user_id,
        'owner_manager',
        'booking_requested',
        new.id,
        new.booking_id,
        null,
        new.organization_id,
        new.salon_id,
        'New online booking',
        'A customer submitted an online appointment.',
        '/bookings?bookingId=' || new.booking_id::text,
        jsonb_build_object('source', booking_row.source)
      );
    elsif new.event_type in ('rescheduled', 'cancelled') then
      perform public.insert_app_notification(
        owner_recipient.user_id,
        'owner_manager',
        'booking_' || new.event_type,
        new.id,
        new.booking_id,
        null,
        new.organization_id,
        new.salon_id,
        case new.event_type
          when 'rescheduled' then 'Appointment rescheduled'
          else 'Appointment cancelled'
        end,
        'An appointment changed and may need review.',
        '/bookings?bookingId=' || new.booking_id::text,
        new.metadata
      );
    end if;
  end loop;

  if new.event_type in (
    'staff_assigned',
    'staff_reassigned',
    'confirmed',
    'rescheduled',
    'cancelled',
    'checked_in',
    'service_started',
    'line_started',
    'line_completed'
  ) then
    for staff_recipient in
      select distinct staff.account_user_id, staff.id as staff_id
      from public.booking_lines
      join public.staff
        on staff.id = booking_lines.assigned_staff_id
      where booking_lines.booking_id = new.booking_id
        and (line_id is null or booking_lines.id = line_id)
        and staff.account_user_id is not null
        and staff.is_active = true
    loop
      perform public.insert_app_notification(
        staff_recipient.account_user_id,
        'staff',
        case
          when new.event_type = 'staff_assigned' then 'staff_booking_assigned'
          when new.event_type = 'staff_reassigned' then 'staff_booking_reassigned'
          when new.event_type = 'line_started' then 'staff_line_started'
          when new.event_type = 'line_completed' then 'staff_line_completed'
          else 'staff_booking_' || new.event_type
        end,
        new.id,
        new.booking_id,
        line_id,
        new.organization_id,
        new.salon_id,
        case
          when new.event_type in ('staff_assigned', 'staff_reassigned') then 'Appointment assigned'
          when new.event_type = 'rescheduled' then 'Appointment rescheduled'
          when new.event_type = 'cancelled' then 'Appointment cancelled'
          when new.event_type = 'checked_in' then 'Customer checked in'
          when new.event_type = 'line_started' then 'Service started'
          when new.event_type = 'line_completed' then 'Service completed'
          else 'Appointment update'
        end,
        'Open your schedule for details.',
        '/staff/appointments?bookingId=' || new.booking_id::text,
        new.metadata || jsonb_build_object('staff_id', staff_recipient.staff_id)
      );
    end loop;
  end if;

  if new.event_type = 'staff_reassigned'
    and jsonb_typeof(new.metadata -> 'line_assignments') = 'array'
  then
    for assignment in
      select value
      from jsonb_array_elements(new.metadata -> 'line_assignments')
    loop
      for staff_recipient in
        select staff.account_user_id, staff.id as staff_id
        from public.staff
        where staff.id = nullif(assignment ->> 'old_staff_id', '')::uuid
          and staff.account_user_id is not null
          and staff.is_active = true
      loop
        perform public.insert_app_notification(
          staff_recipient.account_user_id,
          'staff',
          'staff_booking_reassigned_away',
          new.id,
          new.booking_id,
          nullif(assignment ->> 'booking_line_id', '')::uuid,
          new.organization_id,
          new.salon_id,
          'Appointment reassigned',
          'This appointment line moved off your schedule.',
          '/staff/appointments?bookingId=' || new.booking_id::text,
          new.metadata || jsonb_build_object('staff_id', staff_recipient.staff_id)
        );
      end loop;
    end loop;
  end if;

  if booking_row.customer_user_id is not null
    and new.event_type in ('confirmed', 'rescheduled', 'cancelled', 'completed')
  then
    customer_title := case new.event_type
      when 'confirmed' then 'Appointment confirmed'
      when 'rescheduled' then 'Appointment rescheduled'
      when 'cancelled' then 'Appointment cancelled'
      else 'Appointment completed'
    end;

    perform public.insert_app_notification(
      booking_row.customer_user_id,
      'customer',
      'booking_' || new.event_type,
      new.id,
      new.booking_id,
      null,
      new.organization_id,
      new.salon_id,
      customer_title,
      'Your appointment status changed.',
      '/notifications',
      jsonb_build_object('booking_id', new.booking_id)
    );
  end if;

  return new;
end;
$$;

revoke all on function public.notify_booking_status_event()
from public, anon, authenticated;
