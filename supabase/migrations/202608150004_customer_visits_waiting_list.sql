alter table public.pos_live_drafts
add column if not exists customer_handoff_started_at timestamptz;

comment on column public.pos_live_drafts.customer_handoff_started_at is
  'Explicit marker that the live customer display is in POS checkout handoff mode.';

create or replace function public.get_pos_live_draft_by_token(p_token text)
returns table (
  id uuid,
  salon_id uuid,
  token text,
  customer jsonb,
  staff_lines jsonb,
  selected_staff_id text,
  tip numeric,
  subtotal numeric,
  discount numeric,
  tax numeric,
  total_before_tip numeric,
  total numeric,
  status text,
  version integer,
  customer_version integer,
  receipt_version integer,
  completed_at timestamptz,
  reset_at timestamptz,
  last_customer_action_id text,
  last_tip_action_id text,
  updated_at timestamptz,
  server_now timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_row public.pos_live_drafts%rowtype;
begin
  select *
  into draft_row
  from public.pos_live_drafts
  where pos_live_drafts.token = btrim(coalesce(p_token, ''))
  limit 1;

  if draft_row.id is null then
    return;
  end if;

  if draft_row.status = 'closed'
    and draft_row.reset_at is not null
    and draft_row.reset_at <= now()
  then
    update public.pos_live_drafts
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
        version = version + 1
    where pos_live_drafts.id = draft_row.id
    returning * into draft_row;
  end if;

  return query
  select
    drafts.id,
    drafts.salon_id,
    drafts.token,
    drafts.customer,
    drafts.staff_lines,
    drafts.selected_staff_id,
    drafts.tip,
    drafts.subtotal,
    drafts.discount,
    drafts.tax,
    drafts.total_before_tip,
    drafts.total,
    drafts.status,
    drafts.version,
    drafts.customer_version,
    drafts.receipt_version,
    drafts.completed_at,
    drafts.reset_at,
    drafts.last_customer_action_id,
    drafts.last_tip_action_id,
    drafts.updated_at,
    now() as server_now
  from public.pos_live_drafts drafts
  where drafts.id = draft_row.id
  limit 1;
end;
$$;

create table if not exists public.customer_visits (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  appointment_id uuid references public.bookings(id) on delete set null,
  ticket_id uuid references public.pos_tickets(id) on delete set null,
  source text not null default 'customer_screen',
  status text not null default 'waiting',
  checked_in_at timestamptz not null default now(),
  service_started_at timestamptz,
  checkout_started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_reason text,
  created_by_user_id uuid references public.users(id) on delete set null,
  origin_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_visits_source_check check (
    source in ('appointment', 'walk_in', 'customer_screen')
  ),
  constraint customer_visits_status_check check (
    status in ('waiting', 'in_service', 'checkout', 'completed', 'cancelled')
  )
);

create unique index if not exists customer_visits_one_active_customer_uidx
on public.customer_visits(salon_id, customer_id)
where status in ('waiting', 'in_service', 'checkout');

create index if not exists customer_visits_salon_status_checked_in_idx
on public.customer_visits(salon_id, status, checked_in_at);

create index if not exists customer_visits_customer_active_idx
on public.customer_visits(salon_id, customer_id, checked_in_at desc)
where status in ('waiting', 'in_service', 'checkout');

create index if not exists customer_visits_appointment_idx
on public.customer_visits(appointment_id)
where appointment_id is not null;

create index if not exists customer_visits_ticket_idx
on public.customer_visits(ticket_id)
where ticket_id is not null;

drop trigger if exists set_customer_visits_updated_at on public.customer_visits;
create trigger set_customer_visits_updated_at
before update on public.customer_visits
for each row execute function public.set_updated_at();

create or replace function public.validate_customer_visit_relationships()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  appointment_customer_id uuid;
  appointment_salon_id uuid;
  ticket_customer_id uuid;
  ticket_salon_id uuid;
begin
  if not exists (
    select 1
    from public.customers
    where customers.id = new.customer_id
      and customers.location_id = new.salon_id
      and customers.status = 'active'
  ) then
    raise exception 'Customer visit customer must belong to the salon.';
  end if;

  if new.appointment_id is not null then
    select bookings.salon_id, bookings.customer_id
    into appointment_salon_id, appointment_customer_id
    from public.bookings
    where bookings.id = new.appointment_id;

    if appointment_salon_id is distinct from new.salon_id
      or appointment_customer_id is distinct from new.customer_id
    then
      raise exception 'Customer visit appointment must belong to the same salon and customer.';
    end if;
  end if;

  if new.ticket_id is not null then
    select pos_tickets.salon_id, pos_tickets.customer_id
    into ticket_salon_id, ticket_customer_id
    from public.pos_tickets
    where pos_tickets.id = new.ticket_id;

    if ticket_salon_id is distinct from new.salon_id
      or (
        ticket_customer_id is not null
        and ticket_customer_id is distinct from new.customer_id
      )
    then
      raise exception 'Customer visit ticket must belong to the same salon and customer.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_customer_visit_relationships on public.customer_visits;
create trigger validate_customer_visit_relationships
before insert or update of salon_id, customer_id, appointment_id, ticket_id
on public.customer_visits
for each row execute function public.validate_customer_visit_relationships();

alter table public.customer_visits enable row level security;

drop policy if exists "salon_member_read_customer_visits" on public.customer_visits;
create policy "salon_member_read_customer_visits" on public.customer_visits
for select to authenticated
using (
  public.user_has_salon_permission(
    salon_id,
    array['tickets.view', 'tickets.manage', 'booking.view', 'staff.view']
  )
);

drop policy if exists "salon_manager_write_customer_visits" on public.customer_visits;
create policy "salon_manager_write_customer_visits" on public.customer_visits
for all to authenticated
using (
  public.user_has_salon_permission(
    salon_id,
    array['tickets.manage', 'booking.manage']
  )
)
with check (
  public.user_has_salon_permission(
    salon_id,
    array['tickets.manage', 'booking.manage']
  )
);

create or replace function public.customer_visit_first_name(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(split_part(btrim(coalesce(p_name, '')), ' ', 1), '')
$$;

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
    'ticketId', p_visit.ticket_id
  )
$$;

create or replace function public.customer_visit_normalize_booking_status(
  p_status text
)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_status = 'scheduled' then 'confirmed'
    else p_status
  end
$$;

create or replace function public.find_customer_visit_arrival_appointment(
  p_salon_id uuid,
  p_customer_id uuid
)
returns table(appointment_id uuid, match_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  business_date date;
  business_tz text;
  day_start timestamptz;
  day_end timestamptz;
begin
  business_date := public.get_salon_business_date(p_salon_id);
  business_tz := coalesce(public.get_salon_business_timezone(p_salon_id), 'America/Chicago');
  day_start := (business_date::text || ' 00:00:00')::timestamp at time zone business_tz;
  day_end := day_start + interval '1 day';

  return query
  select
    case
      when count(*) = 1 then (array_agg(bookings.id order by bookings.start_at, bookings.id))[1]
      else null
    end as appointment_id,
    count(*)::integer as match_count
  from public.bookings
  where bookings.salon_id = p_salon_id
    and bookings.customer_id = p_customer_id
    and bookings.start_at >= day_start
    and bookings.start_at < day_end
    and public.customer_visit_normalize_booking_status(bookings.status) in (
      'pending',
      'confirmed',
      'checked_in'
    );
end;
$$;

create or replace function public.sync_customer_visit_booking_checked_in(
  p_visit_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_row public.bookings%rowtype;
  visit_row public.customer_visits%rowtype;
  old_status text;
begin
  select *
  into visit_row
  from public.customer_visits
  where id = p_visit_id;

  if visit_row.id is null or visit_row.appointment_id is null then
    return;
  end if;

  select *
  into booking_row
  from public.bookings
  where id = visit_row.appointment_id
    and salon_id = visit_row.salon_id
    and customer_id = visit_row.customer_id
  for update;

  if booking_row.id is null
    or public.customer_visit_normalize_booking_status(booking_row.status) = 'checked_in'
  then
    return;
  end if;

  if public.customer_visit_normalize_booking_status(booking_row.status) not in ('pending', 'confirmed') then
    return;
  end if;

  old_status := public.customer_visit_normalize_booking_status(booking_row.status);

  update public.bookings
  set status = 'checked_in',
      confirmation_status = 'confirmed',
      updated_at = now()
  where id = booking_row.id;

  insert into public.booking_status_events (
    actor_source,
    booking_id,
    event_type,
    metadata,
    new_status,
    old_status,
    salon_id
  )
  values (
    'customer',
    booking_row.id,
    'checked_in',
    jsonb_build_object('customer_visit_id', visit_row.id, 'source', visit_row.source),
    'checked_in',
    old_status,
    visit_row.salon_id
  );
end;
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
  visit_row public.customer_visits%rowtype;
begin
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
  end if;

  return visit_row;
end;
$$;

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
    select *
    into visit_row
    from public.customer_visits
    where salon_id = draft_row.salon_id
      and customer_id = customer_row.id
      and status in ('waiting', 'in_service', 'checkout')
    order by checked_in_at
    limit 1
    for update;

    if visit_row.id is not null and visit_row.status = 'waiting' then
      update public.customer_visits
      set status = 'checkout',
          checkout_started_at = coalesce(checkout_started_at, now())
      where id = visit_row.id
      returning * into visit_row;
    elsif visit_row.id is not null and visit_row.checkout_started_at is null then
      update public.customer_visits
      set checkout_started_at = now()
      where id = visit_row.id
      returning * into visit_row;
    end if;

    customer_payload := jsonb_build_object(
      'id', customer_row.id,
      'name', customer_row.name,
      'phone', customer_row.phone,
      'visitId', visit_row.id
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
      'visit', case
        when visit_row.id is null then null
        else public.customer_visit_public_payload(visit_row, customer_row)
      end
    );
  end if;

  select *
  into visit_row
  from public.customer_visits
  where salon_id = draft_row.salon_id
    and customer_id = customer_row.id
    and status in ('waiting', 'in_service', 'checkout')
  order by checked_in_at
  limit 1
  for update;

  if visit_row.id is not null then
    return jsonb_build_object(
      'ok', true,
      'mode', 'check_in',
      'state', 'already_checked_in',
      'visit', public.customer_visit_public_payload(visit_row, customer_row)
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

create or replace function public.get_customer_visit_queue(
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
    nullif(string_agg(distinct booking_lines.service_name_snapshot, ', '), '') as service_label,
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
    booking_staff.display_name
  order by visits.checked_in_at asc, visits.id asc
  limit greatest(1, least(coalesce(p_limit, 25), 100));
end;
$$;

create or replace function public.cancel_customer_visit(
  p_visit_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  visit_row public.customer_visits%rowtype;
begin
  select *
  into visit_row
  from public.customer_visits
  where id = p_visit_id
  for update;

  if visit_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if not public.user_has_salon_permission(
    visit_row.salon_id,
    array['tickets.manage', 'booking.manage']
  ) then
    raise exception 'Missing required permission.';
  end if;

  if visit_row.status not in ('waiting', 'in_service', 'checkout') then
    return jsonb_build_object('ok', true, 'visitId', visit_row.id, 'status', visit_row.status);
  end if;

  update public.customer_visits
  set cancelled_at = now(),
      cancelled_reason = nullif(btrim(coalesce(p_reason, '')), ''),
      status = 'cancelled'
  where id = visit_row.id
  returning * into visit_row;

  return jsonb_build_object('ok', true, 'visitId', visit_row.id, 'status', visit_row.status);
end;
$$;

create or replace function public.select_customer_visit_for_live_draft(
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

  if not public.user_has_salon_permission(
    visit_row.salon_id,
    array['tickets.manage']
  ) then
    raise exception 'Missing required permission.';
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
    'visitId', visit_row.id
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

create or replace function public.complete_customer_visit_for_ticket(
  p_salon_id uuid,
  p_customer_id uuid,
  p_ticket_id uuid,
  p_preferred_visit_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ticket_row public.pos_tickets%rowtype;
  visit_row public.customer_visits%rowtype;
begin
  select *
  into ticket_row
  from public.pos_tickets
  where id = p_ticket_id
    and salon_id = p_salon_id
  for update;

  if ticket_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'ticket_not_found');
  end if;

  if ticket_row.customer_id is not null
    and ticket_row.customer_id is distinct from p_customer_id
  then
    return jsonb_build_object('ok', false, 'code', 'customer_mismatch');
  end if;

  if not public.user_has_salon_permission(
    p_salon_id,
    array['tickets.manage']
  ) then
    raise exception 'Missing required permission.';
  end if;

  if p_preferred_visit_id is not null then
    select *
    into visit_row
    from public.customer_visits
    where id = p_preferred_visit_id
      and salon_id = p_salon_id
      and customer_id = p_customer_id
      and status in ('waiting', 'in_service', 'checkout')
    order by checked_in_at
    limit 1
    for update;
  end if;

  if visit_row.id is null then
    select *
    into visit_row
    from public.customer_visits
    where salon_id = p_salon_id
      and customer_id = p_customer_id
      and status in ('waiting', 'in_service', 'checkout')
    order by checked_in_at
    limit 1
    for update;
  end if;

  if visit_row.id is null then
    return jsonb_build_object('ok', true, 'visitId', null, 'status', null);
  end if;

  update public.customer_visits
  set completed_at = now(),
      status = 'completed',
      ticket_id = p_ticket_id
  where id = visit_row.id
  returning * into visit_row;

  if visit_row.appointment_id is not null then
    update public.bookings
    set pos_ticket_id = p_ticket_id,
        updated_at = now()
    where id = visit_row.appointment_id
      and salon_id = visit_row.salon_id
      and customer_id = visit_row.customer_id
      and pos_ticket_id is null;
  end if;

  return jsonb_build_object(
    'ok', true,
    'appointmentId', visit_row.appointment_id,
    'status', visit_row.status,
    'ticketId', visit_row.ticket_id,
    'visitId', visit_row.id
  );
end;
$$;

grant select, insert, update, delete on table public.customer_visits to authenticated;
revoke all on table public.customer_visits from anon;

revoke all on function public.resolve_customer_display_submission(text, text, text, text) from public;
grant execute on function public.resolve_customer_display_submission(text, text, text, text) to anon, authenticated;

revoke all on function public.get_customer_visit_queue(uuid, integer) from public;
grant execute on function public.get_customer_visit_queue(uuid, integer) to authenticated;

revoke all on function public.cancel_customer_visit(uuid, text) from public;
grant execute on function public.cancel_customer_visit(uuid, text) to authenticated;

revoke all on function public.select_customer_visit_for_live_draft(uuid, text) from public;
grant execute on function public.select_customer_visit_for_live_draft(uuid, text) to authenticated;

revoke all on function public.complete_customer_visit_for_ticket(uuid, uuid, uuid, uuid) from public;
grant execute on function public.complete_customer_visit_for_ticket(uuid, uuid, uuid, uuid) to authenticated;

grant execute on function public.create_or_reuse_customer_visit(uuid, uuid, text, uuid, jsonb) to authenticated;
grant execute on function public.sync_customer_visit_booking_checked_in(uuid) to authenticated;
