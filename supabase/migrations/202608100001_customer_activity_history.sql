create or replace function public.get_customer_activity(p_limit integer default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  clean_limit integer := greatest(1, least(coalesce(p_limit, 40), 100));
  booking_payload jsonb;
  purchase_payload jsonb;
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  select coalesce(jsonb_agg(entry order by sort_at desc), '[]'::jsonb)
  into purchase_payload
  from (
    select
      coalesce(tickets.closed_at, tickets.opened_at) as sort_at,
      jsonb_build_object(
        'id', tickets.id,
        'ticketId', tickets.id,
        'ticketNumber', tickets.ticket_number,
        'openedAt', tickets.opened_at,
        'closedAt', tickets.closed_at,
        'status', tickets.status,
        'discountType', tickets.discount_type,
        'discountValue', tickets.discount_value,
        'taxRate', tickets.tax_rate,
        'tipType', tickets.tip_type,
        'tipValue', tickets.tip_value,
        'currency', 'USD',
        'salon', jsonb_build_object(
          'id', salons.id,
          'name', coalesce(nullif(btrim(settings.business_name), ''), salons.name),
          'logoPath', settings.public_profile_logo_path,
          'coverPath', settings.public_profile_cover_path
        ),
        'services', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', items.id,
              'serviceId', items.service_id,
              'name', coalesce(
                nullif(btrim(items.service_name_snapshot), ''),
                nullif(btrim(services.name), ''),
                nullif(btrim(split_part(coalesce(items.notes, ''), ' | ', 1)), ''),
                'Service'
              ),
              'staffName', nullif(
                btrim(coalesce(performed_staff.display_name, assigned_staff.display_name, '')),
                ''
              ),
              'quantity', items.quantity,
              'unitPrice', items.unit_price,
              'lineTotal', items.line_total
            )
            order by items.created_at, items.id
          )
          from public.pos_ticket_items items
          left join public.services services on services.id = items.service_id
          left join public.staff assigned_staff on assigned_staff.id = items.assigned_staff_id
          left join public.staff performed_staff on performed_staff.id = items.performed_by_staff_id
          where items.pos_ticket_id = tickets.id
            and items.salon_id = tickets.salon_id
            and coalesce(items.is_removed, false) = false
        ), '[]'::jsonb),
        'payments', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', payments.id,
              'method', payments.payment_method,
              'amount', payments.amount,
              'createdAt', payments.created_at
            )
            order by payments.created_at, payments.id
          )
          from public.pos_payments payments
          where payments.ticket_id = tickets.id
            and payments.salon_id = tickets.salon_id
        ), '[]'::jsonb)
      ) as entry
    from public.pos_tickets tickets
    join public.customers customers on customers.id = tickets.customer_id
    join public.locations salons on salons.id = tickets.salon_id
    left join public.salon_settings settings on settings.salon_id = tickets.salon_id
    where customers.customer_user_id = actor_user_id
      and customers.location_id = tickets.salon_id
      and tickets.status = 'closed'
    order by coalesce(tickets.closed_at, tickets.opened_at) desc, tickets.id desc
    limit clean_limit
  ) purchase_rows;

  select coalesce(jsonb_agg(entry order by sort_bucket asc, sort_at asc, id asc), '[]'::jsonb)
  into booking_payload
  from (
    select
      bookings.id,
      case
        when bookings.start_at >= now()
          and bookings.status not in ('completed', 'cancelled', 'no_show')
        then 0
        else 1
      end as sort_bucket,
      case
        when bookings.start_at >= now()
          and bookings.status not in ('completed', 'cancelled', 'no_show')
        then bookings.start_at
        else ('9999-12-31'::timestamptz - (bookings.start_at - '1970-01-01'::timestamptz))
      end as sort_at,
      jsonb_build_object(
        'id', bookings.id,
        'bookingId', bookings.id,
        'startAt', bookings.start_at,
        'endAt', bookings.end_at,
        'status', bookings.status,
        'confirmationStatus', bookings.confirmation_status,
        'paymentStatus', bookings.payment_status,
        'timezone', bookings.salon_timezone_snapshot,
        'currency', 'USD',
        'salon', jsonb_build_object(
          'id', salons.id,
          'name', coalesce(nullif(btrim(settings.business_name), ''), salons.name),
          'logoPath', settings.public_profile_logo_path,
          'coverPath', settings.public_profile_cover_path
        ),
        'staffName', nullif(btrim(coalesce(booking_staff.display_name, '')), ''),
        'services', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', lines.id,
              'serviceId', lines.service_id,
              'name', coalesce(nullif(btrim(lines.service_name_snapshot), ''), 'Service'),
              'staffName', nullif(btrim(coalesce(line_staff.display_name, '')), ''),
              'lineType', lines.line_type,
              'lineStatus', lines.line_status,
              'scheduledStartAt', lines.scheduled_start_at,
              'scheduledEndAt', lines.scheduled_end_at,
              'lineTotal', lines.line_total
            )
            order by lines.display_order, lines.created_at, lines.id
          )
          from public.booking_lines lines
          left join public.staff line_staff on line_staff.id = lines.assigned_staff_id
          where lines.booking_id = bookings.id
            and lines.salon_id = bookings.salon_id
        ), '[]'::jsonb)
      ) as entry
    from (
      select *
      from (
        select *
        from public.bookings
        where customer_user_id = actor_user_id
          and start_at >= now()
          and status not in ('completed', 'cancelled', 'no_show')
        order by start_at asc, id asc
        limit 10
      ) upcoming_bookings
      union all
      select *
      from (
        select *
        from public.bookings
        where customer_user_id = actor_user_id
          and (
            start_at < now()
            or status in ('completed', 'cancelled', 'no_show')
          )
        order by start_at desc, id desc
        limit clean_limit
      ) history_bookings
    ) bookings
    join public.locations salons on salons.id = bookings.salon_id
    left join public.salon_settings settings on settings.salon_id = bookings.salon_id
    left join public.staff booking_staff on booking_staff.id = bookings.staff_id
  ) booking_rows;

  return jsonb_build_object(
    'ok', true,
    'serverNow', now(),
    'purchases', purchase_payload,
    'bookings', booking_payload
  );
end;
$$;

create or replace function public.get_customer_activity_receipt(p_ticket_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  receipt_payload jsonb;
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  if p_ticket_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select jsonb_build_object(
    'id', tickets.id,
    'ticketId', tickets.id,
    'ticketNumber', tickets.ticket_number,
    'openedAt', tickets.opened_at,
    'closedAt', tickets.closed_at,
    'status', tickets.status,
    'discountType', tickets.discount_type,
    'discountValue', tickets.discount_value,
    'taxRate', tickets.tax_rate,
    'tipType', tickets.tip_type,
    'tipValue', tickets.tip_value,
    'currency', 'USD',
    'customer', jsonb_build_object(
      'name', customers.name
    ),
    'salon', jsonb_build_object(
      'id', salons.id,
      'name', coalesce(nullif(btrim(settings.business_name), ''), salons.name),
      'phone', coalesce(settings.phone, salons.phone),
      'addressLine1', coalesce(settings.address_line1, salons.address_line1),
      'addressLine2', coalesce(settings.address_line2, salons.address_line2),
      'city', coalesce(settings.city, salons.city),
      'state', coalesce(settings.state, salons.state),
      'postalCode', coalesce(settings.postal_code, salons.postal_code),
      'country', coalesce(settings.country, salons.country),
      'logoPath', settings.public_profile_logo_path,
      'coverPath', settings.public_profile_cover_path
    ),
    'services', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', items.id,
          'serviceId', items.service_id,
          'name', coalesce(
            nullif(btrim(items.service_name_snapshot), ''),
            nullif(btrim(services.name), ''),
            nullif(btrim(split_part(coalesce(items.notes, ''), ' | ', 1)), ''),
            'Service'
          ),
          'staffName', nullif(
            btrim(coalesce(performed_staff.display_name, assigned_staff.display_name, '')),
            ''
          ),
          'quantity', items.quantity,
          'unitPrice', items.unit_price,
          'lineTotal', items.line_total
        )
        order by items.created_at, items.id
      )
      from public.pos_ticket_items items
      left join public.services services on services.id = items.service_id
      left join public.staff assigned_staff on assigned_staff.id = items.assigned_staff_id
      left join public.staff performed_staff on performed_staff.id = items.performed_by_staff_id
      where items.pos_ticket_id = tickets.id
        and items.salon_id = tickets.salon_id
        and coalesce(items.is_removed, false) = false
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', payments.id,
          'method', payments.payment_method,
          'amount', payments.amount,
          'createdAt', payments.created_at
        )
        order by payments.created_at, payments.id
      )
      from public.pos_payments payments
      where payments.ticket_id = tickets.id
        and payments.salon_id = tickets.salon_id
    ), '[]'::jsonb)
  )
  into receipt_payload
  from public.pos_tickets tickets
  join public.customers customers on customers.id = tickets.customer_id
  join public.locations salons on salons.id = tickets.salon_id
  left join public.salon_settings settings on settings.salon_id = tickets.salon_id
  where tickets.id = p_ticket_id
    and tickets.status = 'closed'
    and customers.customer_user_id = actor_user_id
    and customers.location_id = tickets.salon_id
  limit 1;

  if receipt_payload is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'ticket', receipt_payload
  );
end;
$$;

grant execute on function public.get_customer_activity(integer) to authenticated;
grant execute on function public.get_customer_activity_receipt(uuid) to authenticated;
