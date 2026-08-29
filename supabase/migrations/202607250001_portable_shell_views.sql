alter table public.pos_portable_access_keys
add column if not exists capabilities text[] not null default array[
  'portable.pos.use',
  'portable.today.view',
  'portable.book.view',
  'portable.book.create',
  'portable.book.cancel'
]::text[];

alter table public.pos_portable_access_keys
alter column capabilities set default array[
  'portable.pos.use',
  'portable.today.view',
  'portable.book.view',
  'portable.book.create',
  'portable.book.cancel'
]::text[];

alter table public.pos_portable_access_keys
drop constraint if exists pos_portable_access_keys_capabilities_valid;

alter table public.pos_portable_access_keys
add constraint pos_portable_access_keys_capabilities_valid
check (
  capabilities <@ array[
    'portable.pos.use',
    'portable.today.view',
    'portable.book.view',
    'portable.book.create',
    'portable.book.cancel',
    'portable.report.view'
  ]::text[]
);

create or replace function public.pos_portable_access_has_capability(
  p_key_id uuid,
  p_session_signature text,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pos_portable_access_keys access_keys
    where access_keys.id = p_key_id
      and access_keys.is_active = true
      and p_capability = any(access_keys.capabilities)
      and p_session_signature = public.pos_portable_access_signature(
        access_keys.id,
        access_keys.passcode_digest
      )
  )
$$;

create or replace function public.get_pos_portable_access_context(
  p_key_id uuid,
  p_session_signature text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_salon_id uuid;
  context_row record;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null then
    return null;
  end if;

  select
    access_keys.access_id,
    access_keys.capabilities,
    access_keys.id as key_id,
    locations.id as salon_id,
    locations.name as salon_name
  into context_row
  from public.pos_portable_access_keys access_keys
  join public.locations on locations.id = access_keys.salon_id
  where access_keys.id = p_key_id
    and access_keys.salon_id = target_salon_id
  limit 1;

  return jsonb_build_object(
    'key_id', context_row.key_id,
    'access_id', context_row.access_id,
    'capabilities', to_jsonb(context_row.capabilities),
    'salon_id', context_row.salon_id,
    'salon_name', context_row.salon_name
  );
end;
$$;

create or replace function public.get_pos_portable_book_data(
  p_key_id uuid,
  p_session_signature text,
  p_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_salon_id uuid;
  target_timezone text;
  range_start timestamptz;
  range_end timestamptz;
  appointments_json jsonb;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null
    or not public.pos_portable_access_has_capability(
      p_key_id,
      p_session_signature,
      'portable.book.view'
    )
  then
    return null;
  end if;

  select coalesce(booking_settings.timezone_iana, 'America/Chicago')
  into target_timezone
  from public.booking_settings
  where booking_settings.salon_id = target_salon_id
  limit 1;

  target_timezone := coalesce(target_timezone, 'America/Chicago');
  range_start := p_date::timestamp at time zone target_timezone;
  range_end := (p_date + 1)::timestamp at time zone target_timezone;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'customerName', bookings.customer_name,
        'customerPhone', bookings.customer_phone,
        'endAt', bookings.end_at,
        'id', bookings.id,
        'serviceNames', bookings.service_names,
        'staffName', bookings.staff_name,
        'startAt', bookings.start_at,
        'status', bookings.status
      )
      order by bookings.start_at
    ),
    '[]'::jsonb
  )
  into appointments_json
  from (
    select
      bookings.id,
      bookings.start_at,
      bookings.end_at,
      bookings.status,
      customers.name as customer_name,
      customers.phone as customer_phone,
      staff.display_name as staff_name,
      coalesce(
        (
          select jsonb_agg(booking_lines.service_name_snapshot order by booking_lines.display_order)
          from public.booking_lines
          where booking_lines.booking_id = bookings.id
            and booking_lines.salon_id = target_salon_id
            and booking_lines.line_status <> 'cancelled'
        ),
        '[]'::jsonb
      ) as service_names
    from public.bookings
    left join public.customers on customers.id = bookings.customer_id
    left join public.staff on staff.id = bookings.staff_id
    where bookings.salon_id = target_salon_id
      and bookings.start_at < range_end
      and bookings.end_at > range_start
      and bookings.status not in ('cancelled', 'no_show')
    order by bookings.start_at
    limit 200
  ) bookings;

  return jsonb_build_object(
    'appointments', appointments_json,
    'timezone', target_timezone
  );
end;
$$;

create or replace function public.get_pos_portable_report_data(
  p_key_id uuid,
  p_session_signature text,
  p_report_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_salon_id uuid;
  target_salon_name text;
  target_timezone text;
  range_start timestamptz;
  range_end timestamptz;
  totals_row record;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null
    or not public.pos_portable_access_has_capability(
      p_key_id,
      p_session_signature,
      'portable.report.view'
    )
  then
    return null;
  end if;

  select locations.name
  into target_salon_name
  from public.locations
  where locations.id = target_salon_id
  limit 1;

  select coalesce(booking_settings.timezone_iana, 'America/Chicago')
  into target_timezone
  from public.booking_settings
  where booking_settings.salon_id = target_salon_id
  limit 1;

  target_timezone := coalesce(target_timezone, 'America/Chicago');
  range_start := p_report_date::timestamp at time zone target_timezone;
  range_end := (p_report_date + 1)::timestamp at time zone target_timezone;

  with ticket_scope as (
    select *
    from public.pos_tickets
    where pos_tickets.salon_id = target_salon_id
      and pos_tickets.opened_at >= range_start
      and pos_tickets.opened_at < range_end
      and pos_tickets.status = 'closed'
  ),
  item_totals as (
    select
      count(pos_ticket_items.id)::integer as service_count,
      coalesce(sum(pos_ticket_items.line_total), 0)::numeric as service_total
    from public.pos_ticket_items
    join ticket_scope on ticket_scope.id = pos_ticket_items.pos_ticket_id
    where pos_ticket_items.salon_id = target_salon_id
      and coalesce(pos_ticket_items.is_removed, false) = false
  ),
  payment_totals as (
    select coalesce(sum(pos_payments.amount), 0)::numeric as payment_total
    from public.pos_payments
    join ticket_scope on ticket_scope.id = pos_payments.ticket_id
    where pos_payments.salon_id = target_salon_id
  ),
  ticket_totals as (
    select
      count(ticket_scope.id)::integer as ticket_count,
      coalesce(sum(ticket_scope.tip_value), 0)::numeric as tips,
      coalesce(sum(
        case
          when ticket_scope.discount_type = 'percentage'
          then 0
          else ticket_scope.discount_value
        end
      ), 0)::numeric as discounts,
      0::numeric as taxes
    from ticket_scope
  )
  select
    item_totals.service_count,
    payment_totals.payment_total,
    ticket_totals.discounts,
    ticket_totals.taxes,
    ticket_totals.ticket_count,
    ticket_totals.tips
  into totals_row
  from item_totals, payment_totals, ticket_totals;

  return jsonb_build_object(
    'salonName', target_salon_name,
    'totals', jsonb_build_object(
      'discounts', coalesce(totals_row.discounts, 0),
      'expectedTotal', coalesce(totals_row.payment_total, 0),
      'serviceCount', coalesce(totals_row.service_count, 0),
      'taxes', coalesce(totals_row.taxes, 0),
      'ticketCount', coalesce(totals_row.ticket_count, 0),
      'tips', coalesce(totals_row.tips, 0)
    )
  );
end;
$$;

grant execute on function public.pos_portable_access_has_capability(uuid, text, text) to anon, authenticated;
grant execute on function public.get_pos_portable_access_context(uuid, text) to anon, authenticated;
grant execute on function public.get_pos_portable_book_data(uuid, text, date) to anon, authenticated;
grant execute on function public.get_pos_portable_report_data(uuid, text, date) to anon, authenticated;
