create table if not exists public.customer_visit_services (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.customer_visits(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete restrict,
  sort_order integer not null default 1 check (sort_order > 0),
  created_at timestamptz not null default now(),
  unique (visit_id, service_id)
);

create index if not exists customer_visit_services_visit_order_idx
  on public.customer_visit_services(visit_id, sort_order, id);

create index if not exists customer_visit_services_service_id_idx
  on public.customer_visit_services(service_id);

alter table public.customer_visit_services enable row level security;

drop policy if exists "salon_member_read_customer_visit_services" on public.customer_visit_services;
create policy "salon_member_read_customer_visit_services"
on public.customer_visit_services
for select to authenticated
using (
  exists (
    select 1
    from public.customer_visits visits
    where visits.id = customer_visit_services.visit_id
      and public.user_can_manage_salon(visits.salon_id)
  )
);

drop policy if exists "salon_manager_write_customer_visit_services" on public.customer_visit_services;
create policy "salon_manager_write_customer_visit_services"
on public.customer_visit_services
for all to authenticated
using (
  exists (
    select 1
    from public.customer_visits visits
    where visits.id = customer_visit_services.visit_id
      and public.user_has_salon_permission(visits.salon_id, array['tickets.manage', 'booking.manage'])
  )
)
with check (
  exists (
    select 1
    from public.customer_visits visits
    where visits.id = customer_visit_services.visit_id
      and public.user_has_salon_permission(visits.salon_id, array['tickets.manage', 'booking.manage'])
  )
);

revoke all on table public.customer_visit_services from anon;
grant select on table public.customer_visit_services to authenticated;

insert into public.customer_visit_services (
  visit_id,
  service_id,
  sort_order
)
select
  visits.id,
  booking_lines.service_id,
  row_number() over (
    partition by visits.id
    order by booking_lines.display_order, booking_lines.id
  )::integer as sort_order
from public.customer_visits visits
join public.booking_lines booking_lines
  on booking_lines.booking_id = visits.appointment_id
 and booking_lines.salon_id = visits.salon_id
 and booking_lines.line_status <> 'cancelled'
 and booking_lines.service_id is not null
join public.services services
  on services.id = booking_lines.service_id
 and services.salon_id = visits.salon_id
 and services.is_active = true
where visits.appointment_id is not null
on conflict (visit_id, service_id) do nothing;

create or replace function public.customer_visit_requested_services_json(
  p_visit_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', services.id,
        'name', services.name,
        'category', services.category,
        'basePrice', services.base_price,
        'durationMinutes', services.duration_minutes,
        'sortOrder', visit_services.sort_order
      )
      order by visit_services.sort_order, services.name, services.id
    ),
    '[]'::jsonb
  )
  from public.customer_visit_services visit_services
  join public.customer_visits visits
    on visits.id = visit_services.visit_id
  join public.services services
    on services.id = visit_services.service_id
   and services.salon_id = visits.salon_id
   and services.is_active = true
  where visit_services.visit_id = p_visit_id
$$;

revoke all on function public.customer_visit_requested_services_json(uuid) from public;
revoke all on function public.customer_visit_requested_services_json(uuid) from anon;
revoke all on function public.customer_visit_requested_services_json(uuid) from authenticated;

create or replace function public.customer_visit_public_payload(
  p_visit public.customer_visits,
  p_customer public.customers
)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', p_visit.id,
    'customerId', p_visit.customer_id,
    'firstName', public.customer_visit_first_name(p_customer.name),
    'checkedInAt', p_visit.checked_in_at,
    'source', p_visit.source,
    'status', p_visit.status,
    'appointmentId', p_visit.appointment_id,
    'ticketId', p_visit.ticket_id,
    'requestedServices', public.customer_visit_requested_services_json(p_visit.id)
  )
$$;

create or replace function public.create_or_reuse_customer_visit(
  p_salon_id uuid,
  p_customer_id uuid,
  p_source text default 'customer_screen',
  p_appointment_id uuid default null,
  p_origin_metadata jsonb default '{}'::jsonb
)
returns public.customer_visits
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_source text := case
    when p_source in ('appointment', 'walk_in', 'customer_screen') then p_source
    else 'customer_screen'
  end;
  normalized_phone text;
  visit_row public.customer_visits%rowtype;
begin
  select public.normalize_customer_claim_phone(customers.phone)
  into normalized_phone
  from public.customers
  where customers.id = p_customer_id
    and customers.location_id = p_salon_id
    and customers.status = 'active'
  limit 1;

  if normalized_phone is not null then
    select visits.*
    into visit_row
    from public.customer_visits visits
    join public.customers customers
      on customers.id = visits.customer_id
     and customers.location_id = visits.salon_id
    where visits.salon_id = p_salon_id
      and visits.status in ('waiting', 'in_service', 'checkout')
      and public.normalize_customer_claim_phone(customers.phone) = normalized_phone
    order by visits.checked_in_at, visits.id
    limit 1
    for update of visits;

    if visit_row.id is not null then
      return visit_row;
    end if;
  end if;

  select *
  into visit_row
  from public.customer_visits
  where salon_id = p_salon_id
    and customer_id = p_customer_id
    and status in ('waiting', 'in_service', 'checkout')
  order by checked_in_at
  limit 1
  for update;

  if visit_row.id is not null then
    return visit_row;
  end if;

  begin
    insert into public.customer_visits (
      appointment_id,
      customer_id,
      origin_metadata,
      salon_id,
      source,
      status
    )
    values (
      p_appointment_id,
      p_customer_id,
      coalesce(p_origin_metadata, '{}'::jsonb),
      p_salon_id,
      clean_source,
      'waiting'
    )
    returning * into visit_row;
  exception when unique_violation then
    select *
    into visit_row
    from public.customer_visits
    where salon_id = p_salon_id
      and customer_id = p_customer_id
      and status in ('waiting', 'in_service', 'checkout')
    order by checked_in_at
    limit 1;
  end;

  if visit_row.appointment_id is not null then
    perform public.sync_customer_visit_booking_checked_in(visit_row.id);

    insert into public.customer_visit_services (
      visit_id,
      service_id,
      sort_order
    )
    select
      visit_row.id,
      booking_lines.service_id,
      row_number() over (order by booking_lines.display_order, booking_lines.id)::integer
    from public.booking_lines booking_lines
    join public.services services
      on services.id = booking_lines.service_id
     and services.salon_id = visit_row.salon_id
     and services.is_active = true
    where booking_lines.booking_id = visit_row.appointment_id
      and booking_lines.salon_id = visit_row.salon_id
      and booking_lines.line_status <> 'cancelled'
      and booking_lines.service_id is not null
    on conflict (visit_id, service_id) do nothing;
  end if;

  return visit_row;
end;
$$;

drop function if exists public.get_customer_visit_queue(uuid, integer);
drop function if exists public.customer_visit_queue_rows(uuid, integer);

create function public.customer_visit_queue_rows(
  p_salon_id uuid,
  p_limit integer default 25
)
returns table (
  id uuid,
  salon_id uuid,
  customer_id uuid,
  customer_name text,
  customer_phone text,
  appointment_id uuid,
  appointment_start_at timestamptz,
  ticket_id uuid,
  source text,
  status text,
  checked_in_at timestamptz,
  service_label text,
  requested_services jsonb,
  assigned_staff_id uuid,
  assigned_staff_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    visits.id,
    visits.salon_id,
    visits.customer_id,
    customers.name as customer_name,
    customers.phone as customer_phone,
    visits.appointment_id,
    bookings.start_at as appointment_start_at,
    visits.ticket_id,
    visits.source,
    visits.status,
    visits.checked_in_at,
    coalesce(
      requested.requested_label,
      nullif(string_agg(distinct booking_lines.service_name_snapshot, ', '), '')
    ) as service_label,
    coalesce(requested.requested_services, '[]'::jsonb) as requested_services,
    coalesce(
      bookings.staff_id,
      (array_agg(booking_lines.assigned_staff_id order by booking_lines.display_order)
        filter (where booking_lines.assigned_staff_id is not null))[1]
    ) as assigned_staff_id,
    coalesce(booking_staff.display_name, min(line_staff.display_name)) as assigned_staff_name
  from public.customer_visits visits
  join public.customers customers
    on customers.id = visits.customer_id
   and customers.location_id = visits.salon_id
  left join public.bookings bookings
    on bookings.id = visits.appointment_id
   and bookings.salon_id = visits.salon_id
  left join public.booking_lines booking_lines
    on booking_lines.booking_id = bookings.id
   and booking_lines.salon_id = visits.salon_id
   and booking_lines.line_status <> 'cancelled'
  left join public.staff booking_staff
    on booking_staff.id = bookings.staff_id
   and booking_staff.salon_id = visits.salon_id
  left join public.staff line_staff
    on line_staff.id = booking_lines.assigned_staff_id
   and line_staff.salon_id = visits.salon_id
  left join lateral (
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', services.id,
            'name', services.name,
            'category', services.category,
            'basePrice', services.base_price,
            'durationMinutes', services.duration_minutes,
            'sortOrder', visit_services.sort_order
          )
          order by visit_services.sort_order, services.name, services.id
        ),
        '[]'::jsonb
      ) as requested_services,
      nullif(string_agg(services.name, ' / ' order by visit_services.sort_order, services.name), '') as requested_label
    from public.customer_visit_services visit_services
    join public.services services
      on services.id = visit_services.service_id
     and services.salon_id = visits.salon_id
     and services.is_active = true
    where visit_services.visit_id = visits.id
  ) requested on true
  where visits.salon_id = p_salon_id
    and visits.status = 'waiting'
  group by
    visits.id,
    visits.salon_id,
    visits.customer_id,
    customers.name,
    customers.phone,
    visits.appointment_id,
    bookings.start_at,
    visits.ticket_id,
    visits.source,
    visits.status,
    visits.checked_in_at,
    bookings.staff_id,
    booking_staff.display_name,
    requested.requested_label,
    requested.requested_services
  order by visits.checked_in_at asc, visits.id asc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
$$;

create function public.get_customer_visit_queue(
  p_salon_id uuid,
  p_limit integer default 25
)
returns table (
  id uuid,
  salon_id uuid,
  customer_id uuid,
  customer_name text,
  customer_phone text,
  appointment_id uuid,
  appointment_start_at timestamptz,
  ticket_id uuid,
  source text,
  status text,
  checked_in_at timestamptz,
  service_label text,
  requested_services jsonb,
  assigned_staff_id uuid,
  assigned_staff_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.user_has_salon_permission(
    p_salon_id,
    array['tickets.view', 'tickets.manage', 'booking.view', 'staff.view']
  ) then
    raise exception 'Missing required permission.';
  end if;

  return query
  select *
  from public.customer_visit_queue_rows(p_salon_id, p_limit);
end;
$$;

revoke all on function public.customer_visit_queue_rows(uuid, integer) from public;
revoke all on function public.customer_visit_queue_rows(uuid, integer) from anon;
revoke all on function public.customer_visit_queue_rows(uuid, integer) from authenticated;

revoke all on function public.get_customer_visit_queue(uuid, integer) from public;
grant execute on function public.get_customer_visit_queue(uuid, integer) to authenticated;

create or replace function public.update_customer_visit_requested_services(
  p_token text,
  p_visit_id uuid,
  p_service_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_row public.pos_live_drafts%rowtype;
  invalid_count integer;
  requested_count integer;
  service_id_count integer;
  service_ids uuid[] := coalesce(p_service_ids, '{}'::uuid[]);
  visit_row public.customer_visits%rowtype;
  customer_row public.customers%rowtype;
begin
  select *
  into draft_row
  from public.pos_live_drafts
  where token = btrim(coalesce(p_token, ''))
    and status = 'draft'
  limit 1;

  if draft_row.id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'not_ready',
      'message', 'Customer screen is not ready.'
    );
  end if;

  select *
  into visit_row
  from public.customer_visits
  where id = p_visit_id
    and salon_id = draft_row.salon_id
    and status in ('waiting', 'in_service', 'checkout')
  for update;

  if visit_row.id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'not_found',
      'message', 'This check-in is no longer active.'
    );
  end if;

  select *
  into customer_row
  from public.customers
  where id = visit_row.customer_id
    and location_id = visit_row.salon_id
    and status = 'active';

  if customer_row.id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'customer_not_found',
      'message', 'Customer profile is unavailable.'
    );
  end if;

  with normalized as (
    select service_id, min(sort_order)::integer as sort_order
    from unnest(service_ids) with ordinality as submitted(service_id, sort_order)
    where service_id is not null
    group by service_id
  )
  select count(*)
  into requested_count
  from normalized;

  if requested_count > 8 then
    return jsonb_build_object(
      'ok', false,
      'code', 'too_many_services',
      'message', 'Select up to 8 services.'
    );
  end if;

  with normalized as (
    select service_id, min(sort_order)::integer as sort_order
    from unnest(service_ids) with ordinality as submitted(service_id, sort_order)
    where service_id is not null
    group by service_id
  ),
  valid_services as (
    select normalized.service_id
    from normalized
    join public.services services
      on services.id = normalized.service_id
     and services.salon_id = draft_row.salon_id
     and services.is_active = true
     and services.online_booking_enabled = true
  )
  select
    requested_count - count(valid_services.service_id),
    count(valid_services.service_id)
  into invalid_count, service_id_count
  from valid_services;

  if invalid_count > 0 then
    return jsonb_build_object(
      'ok', false,
      'code', 'invalid_services',
      'message', 'Selected services must be available for this salon.'
    );
  end if;

  delete from public.customer_visit_services
  where visit_id = visit_row.id;

  if service_id_count > 0 then
    insert into public.customer_visit_services (
      visit_id,
      service_id,
      sort_order
    )
    select
      visit_row.id,
      normalized.service_id,
      row_number() over (order by normalized.sort_order, normalized.service_id)::integer
    from (
      select service_id, min(sort_order)::integer as sort_order
      from unnest(service_ids) with ordinality as submitted(service_id, sort_order)
      where service_id is not null
      group by service_id
    ) normalized
    join public.services services
      on services.id = normalized.service_id
     and services.salon_id = draft_row.salon_id
     and services.is_active = true
     and services.online_booking_enabled = true
    order by normalized.sort_order, normalized.service_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'visit', public.customer_visit_public_payload(visit_row, customer_row)
  );
end;
$$;

revoke all on function public.update_customer_visit_requested_services(text, uuid, uuid[]) from public;
grant execute on function public.update_customer_visit_requested_services(text, uuid, uuid[]) to anon, authenticated;

create or replace function public.get_customer_display_service_catalog(
  p_token text
)
returns table (
  id uuid,
  name text,
  category text,
  base_price numeric,
  duration_minutes integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_salon_id uuid;
begin
  select salon_id
  into target_salon_id
  from public.pos_live_drafts
  where token = btrim(coalesce(p_token, ''))
  limit 1;

  if target_salon_id is null then
    return;
  end if;

  return query
  select
    services.id,
    services.name,
    services.category,
    services.base_price,
    services.duration_minutes
  from public.services
  where services.salon_id = target_salon_id
    and services.is_active = true
    and services.online_booking_enabled = true
  order by services.category nulls last, services.name, services.id;
end;
$$;

revoke all on function public.get_customer_display_service_catalog(text) from public;
grant execute on function public.get_customer_display_service_catalog(text) to anon, authenticated;

create or replace function public.resolve_customer_display_submission(
  p_token text,
  p_phone text,
  p_customer_name text default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  appointment_candidate uuid;
  appointment_count integer;
  clean_name text := nullif(btrim(coalesce(p_customer_name, '')), '');
  clean_request_id text := nullif(btrim(coalesce(p_request_id, '')), '');
  customer_payload jsonb;
  customer_row public.customers%rowtype;
  draft_row public.pos_live_drafts%rowtype;
  is_checkout_handoff boolean;
  normalized_phone text := public.normalize_customer_claim_phone(p_phone);
  snapshot jsonb;
  visit_row public.customer_visits%rowtype;
begin
  select *
  into draft_row
  from public.pos_live_drafts
  where token = btrim(coalesce(p_token, ''))
  for update;

  if draft_row.id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'not_ready',
      'message', 'Customer screen is not ready.'
    );
  end if;

  if normalized_phone is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'invalid_phone',
      'message', 'Please enter a valid phone number.'
    );
  end if;

  is_checkout_handoff := draft_row.status = 'draft'
    and draft_row.customer_handoff_started_at is not null;

  select visits.*
  into visit_row
  from public.customer_visits visits
  join public.customers customers
    on customers.id = visits.customer_id
   and customers.location_id = visits.salon_id
  where visits.salon_id = draft_row.salon_id
    and visits.status in ('waiting', 'in_service', 'checkout')
    and customers.status = 'active'
    and public.normalize_customer_claim_phone(customers.phone) = normalized_phone
  order by visits.checked_in_at, visits.id
  limit 1
  for update of visits;

  if visit_row.id is not null then
    select *
    into customer_row
    from public.customers
    where id = visit_row.customer_id
      and location_id = visit_row.salon_id
      and status = 'active';

    if is_checkout_handoff then
      if visit_row.status = 'waiting' then
        update public.customer_visits
        set status = 'checkout',
            checkout_started_at = coalesce(checkout_started_at, now())
        where id = visit_row.id
        returning * into visit_row;
      elsif visit_row.checkout_started_at is null then
        update public.customer_visits
        set checkout_started_at = now()
        where id = visit_row.id
        returning * into visit_row;
      end if;

      customer_payload := jsonb_build_object(
        'id', customer_row.id,
        'name', customer_row.name,
        'phone', customer_row.phone,
        'visitId', visit_row.id,
        'requestedServices', public.customer_visit_requested_services_json(visit_row.id)
      );

      if clean_request_id is null or draft_row.last_customer_action_id is distinct from clean_request_id then
        update public.pos_live_drafts
        set customer = customer_payload,
            customer_version = customer_version + 1,
            last_customer_action_id = clean_request_id,
            version = version + 1
        where id = draft_row.id;
      end if;

      snapshot := (
        select to_jsonb(live_snapshot)
        from public.get_pos_live_draft_by_token(draft_row.token) live_snapshot
        limit 1
      );

      return jsonb_build_object(
        'ok', true,
        'mode', 'checkout',
        'snapshot', snapshot,
        'visit', public.customer_visit_public_payload(visit_row, customer_row)
      );
    end if;

    return jsonb_build_object(
      'ok', true,
      'mode', 'check_in',
      'state', 'already_checked_in',
      'visit', public.customer_visit_public_payload(visit_row, customer_row)
    );
  end if;

  select *
  into customer_row
  from public.customers
  where location_id = draft_row.salon_id
    and status = 'active'
    and public.normalize_customer_claim_phone(phone) = normalized_phone
  order by created_at desc
  limit 1;

  if customer_row.id is null and clean_name is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'profile_required',
      'message', 'Please enter your name to continue.',
      'mode', case when is_checkout_handoff then 'checkout' else 'check_in' end
    );
  end if;

  if customer_row.id is null then
    insert into public.customers (
      location_id,
      name,
      phone,
      source,
      status
    )
    values (
      draft_row.salon_id,
      clean_name,
      normalized_phone,
      case when is_checkout_handoff then 'pos' else 'manual' end,
      'active'
    )
    returning * into customer_row;
  end if;

  if is_checkout_handoff then
    customer_payload := jsonb_build_object(
      'id', customer_row.id,
      'name', customer_row.name,
      'phone', customer_row.phone,
      'visitId', null,
      'requestedServices', '[]'::jsonb
    );

    if clean_request_id is null or draft_row.last_customer_action_id is distinct from clean_request_id then
      update public.pos_live_drafts
      set customer = customer_payload,
          customer_version = customer_version + 1,
          last_customer_action_id = clean_request_id,
          version = version + 1
      where id = draft_row.id;
    end if;

    snapshot := (
      select to_jsonb(live_snapshot)
      from public.get_pos_live_draft_by_token(draft_row.token) live_snapshot
      limit 1
    );

    return jsonb_build_object(
      'ok', true,
      'mode', 'checkout',
      'snapshot', snapshot,
      'visit', null
    );
  end if;

  select match.appointment_id, match.match_count
  into appointment_candidate, appointment_count
  from public.find_customer_visit_arrival_appointment(draft_row.salon_id, customer_row.id) match;

  if coalesce(appointment_count, 0) > 1 then
    return jsonb_build_object(
      'ok', false,
      'code', 'ambiguous_appointment',
      'message', 'Please ask the front desk to check you in.'
    );
  end if;

  visit_row := public.create_or_reuse_customer_visit(
    draft_row.salon_id,
    customer_row.id,
    case when appointment_candidate is not null then 'appointment' else 'customer_screen' end,
    appointment_candidate,
    jsonb_build_object('source', 'customer_display', 'token', draft_row.token)
  );

  return jsonb_build_object(
    'ok', true,
    'mode', 'check_in',
    'state', 'checked_in',
    'visit', public.customer_visit_public_payload(visit_row, customer_row)
  );
end;
$$;

create or replace function public.apply_customer_visit_to_live_draft(
  p_visit_id uuid,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  customer_payload jsonb;
  customer_row public.customers%rowtype;
  draft_row public.pos_live_drafts%rowtype;
  snapshot jsonb;
  visit_row public.customer_visits%rowtype;
begin
  select *
  into visit_row
  from public.customer_visits
  where id = p_visit_id
    and status in ('waiting', 'in_service', 'checkout')
  for update;

  if visit_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select *
  into customer_row
  from public.customers
  where id = visit_row.customer_id
    and location_id = visit_row.salon_id
    and status = 'active';

  if customer_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'customer_not_found');
  end if;

  select *
  into draft_row
  from public.pos_live_drafts
  where token = btrim(coalesce(p_token, ''))
    and salon_id = visit_row.salon_id
  for update;

  if draft_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_ready');
  end if;

  customer_payload := jsonb_build_object(
    'id', customer_row.id,
    'name', customer_row.name,
    'phone', customer_row.phone,
    'visitId', visit_row.id,
    'requestedServices', public.customer_visit_requested_services_json(visit_row.id)
  );

  update public.pos_live_drafts
  set completed_at = null,
      customer = customer_payload,
      customer_version = customer_version + 1,
      last_customer_action_id = null,
      reset_at = null,
      status = 'draft',
      version = version + 1
  where id = draft_row.id
  returning * into draft_row;

  snapshot := (
    select to_jsonb(live_snapshot)
    from public.get_pos_live_draft_by_token(draft_row.token) live_snapshot
    limit 1
  );

  return jsonb_build_object(
    'ok', true,
    'snapshot', snapshot,
    'visit', public.customer_visit_public_payload(visit_row, customer_row)
  );
end;
$$;

create or replace function public.reset_completed_pos_live_draft(
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_row public.pos_live_drafts%rowtype;
begin
  update public.pos_live_drafts as drafts
  set completed_at = null,
      customer = null,
      customer_handoff_started_at = null,
      discount = 0,
      last_customer_action_id = null,
      last_tip_action_id = null,
      receipt = '{}'::jsonb,
      reset_at = null,
      selected_staff_id = null,
      staff_lines = '[]'::jsonb,
      status = 'draft',
      subtotal = 0,
      tax = 0,
      tip = 0,
      total = 0,
      total_before_tip = 0,
      version = drafts.version + 1
  where drafts.token = btrim(coalesce(p_token, ''))
    and drafts.status = 'closed'
    and drafts.completed_at is not null
  returning drafts.* into draft_row;

  if draft_row.id is null then
    return (
      select to_jsonb(snapshot)
      from public.get_pos_live_draft_by_token(p_token) snapshot
      limit 1
    );
  end if;

  return (
    select to_jsonb(snapshot)
    from public.get_pos_live_draft_by_token(draft_row.token) snapshot
    limit 1
  );
end;
$$;

revoke all on function public.reset_completed_pos_live_draft(text) from public;
grant execute on function public.reset_completed_pos_live_draft(text) to anon, authenticated;

create or replace function public.get_pos_portable_desk_data(
  p_key_id uuid,
  p_session_signature text,
  p_work_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  check_in_enabled boolean;
  draft_row public.pos_live_drafts%rowtype;
  draft_snapshot jsonb;
  salon_name text;
  services_json jsonb;
  staff_json jsonb;
  target_salon_id uuid;
  waiting_visits_json jsonb;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null
    or not public.pos_portable_access_has_capability(p_key_id, p_session_signature, 'portable.pos.use')
  then
    return null;
  end if;

  select locations.name
  into salon_name
  from public.locations
  where locations.id = target_salon_id
  limit 1;

  select coalesce(pos_settings.staff_check_in_enabled, false)
  into check_in_enabled
  from public.pos_settings
  where pos_settings.salon_id = target_salon_id;

  perform public.auto_close_stale_staff_workdays(target_salon_id, p_work_date);
  perform public.ensure_staff_workdays_for_queue(target_salon_id, p_work_date);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', services.id,
        'name', services.name,
        'category', services.category,
        'base_price', services.base_price
      )
      order by services.name
    ),
    '[]'::jsonb
  )
  into services_json
  from public.services
  where services.salon_id = target_salon_id
    and services.is_active = true;

  with receipt_turn_counts as (
    select
      turns.staff_id,
      count(*) filter (where turns.turn_type = 'large')::integer as large_turns,
      count(*) filter (where turns.turn_type = 'small')::integer as small_turns,
      count(*)::integer as total_turns
    from public.pos_ticket_item_turn_parts turns
    where turns.salon_id = target_salon_id
      and turns.work_date = p_work_date
    group by turns.staff_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', staff.id,
        'display_name', staff.display_name,
        'job_title', staff.job_title,
        'is_active', staff.is_active,
        'today_status', coalesce(staff_workdays.status, 'not_checked_in'),
        'check_in_sequence', staff_workdays.check_in_sequence,
        'check_in_at', staff_workdays.check_in_at,
        'turns', jsonb_build_object(
          'largeTurns', coalesce(staff_workdays.queue_turn_count, receipt_turn_counts.large_turns, 0),
          'smallTurns', coalesce(receipt_turn_counts.small_turns, 0),
          'totalTurns', coalesce(staff_workdays.queue_turn_count, receipt_turn_counts.large_turns, 0),
          'queueTurns', coalesce(staff_workdays.queue_turn_count, receipt_turn_counts.large_turns, 0),
          'receiptLargeTurns', coalesce(receipt_turn_counts.large_turns, 0)
        )
      )
      order by
        coalesce(staff_workdays.queue_turn_count, receipt_turn_counts.large_turns, 0),
        case when check_in_enabled then staff_workdays.check_in_sequence end nulls last,
        staff.display_name
    ),
    '[]'::jsonb
  )
  into staff_json
  from public.staff
  left join public.staff_workdays
    on staff_workdays.staff_id = staff.id
    and staff_workdays.salon_id = staff.salon_id
    and staff_workdays.work_date = p_work_date
  left join receipt_turn_counts on receipt_turn_counts.staff_id = staff.id
  where staff.salon_id = target_salon_id
    and staff.is_active = true
    and staff.pos_enabled = true
    and (
      not coalesce(check_in_enabled, false)
      or staff_workdays.status = 'working'
    );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'appointmentId', queue.appointment_id,
        'appointmentStartAt', queue.appointment_start_at,
        'assignedStaffId', queue.assigned_staff_id,
        'assignedStaffName', queue.assigned_staff_name,
        'checkedInAt', queue.checked_in_at,
        'customerId', queue.customer_id,
        'customerName', queue.customer_name,
        'customerPhone', queue.customer_phone,
        'id', queue.id,
        'requestedServices', queue.requested_services,
        'salonId', queue.salon_id,
        'serviceLabel', queue.service_label,
        'source', queue.source,
        'status', queue.status,
        'ticketId', queue.ticket_id
      )
      order by queue.checked_in_at, queue.id
    ),
    '[]'::jsonb
  )
  into waiting_visits_json
  from public.customer_visit_queue_rows(target_salon_id, 25) queue;

  select *
  into draft_row
  from public.pos_live_drafts
  where salon_id = target_salon_id
  order by updated_at desc
  limit 1;

  if draft_row.id is null then
    insert into public.pos_live_drafts (
      receipt,
      salon_id,
      staff_lines,
      subtotal,
      tip,
      token,
      total,
      total_before_tip
    )
    values (
      '{}'::jsonb,
      target_salon_id,
      '[]'::jsonb,
      0,
      0,
      replace(gen_random_uuid()::text, '-', ''),
      0,
      0
    )
    returning * into draft_row;
  end if;

  select to_jsonb(snapshot)
  into draft_snapshot
  from public.get_pos_live_draft_by_token(draft_row.token) snapshot
  limit 1;

  return jsonb_build_object(
    'salonName', salon_name,
    'settings', public.get_pos_setting_payload(target_salon_id),
    'services', services_json,
    'staff', staff_json,
    'waitingVisits', waiting_visits_json,
    'liveDraft', draft_snapshot
  );
end;
$$;

grant execute on function public.get_pos_portable_desk_data(uuid, text, date) to anon, authenticated;

notify pgrst, 'reload schema';
