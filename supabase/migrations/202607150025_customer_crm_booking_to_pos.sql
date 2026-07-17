-- Phase 5: Customer CRM + booking-to-POS ticket foundation.
-- Additive only. Keeps bookings as scheduling source and POS tickets as
-- financial source while recording explicit provenance in both directions.

alter table public.customers
add column if not exists customer_user_id uuid references public.users(id) on delete set null,
add column if not exists source text not null default 'manual',
add column if not exists staff_notes text,
add column if not exists internal_notes text,
add column if not exists created_by_user_id uuid references public.users(id) on delete set null,
add column if not exists updated_by_user_id uuid references public.users(id) on delete set null;

alter table public.customers
drop constraint if exists customers_source_check;

alter table public.customers
add constraint customers_source_check check (
  source in (
    'manual',
    'public_booking',
    'owner_booking',
    'pos',
    'import',
    'account_link'
  )
);

create index if not exists customers_location_customer_user_idx
on public.customers(location_id, customer_user_id)
where customer_user_id is not null;

create index if not exists customers_location_phone_normalized_idx
on public.customers(location_id, regexp_replace(coalesce(phone, ''), '[^0-9]+', '', 'g'))
where nullif(regexp_replace(coalesce(phone, ''), '[^0-9]+', '', 'g'), '') is not null;

create index if not exists customers_location_email_normalized_idx
on public.customers(location_id, lower(btrim(coalesce(email, ''))))
where nullif(lower(btrim(coalesce(email, ''))), '') is not null;

alter table public.booking_settings
add column if not exists ticket_creation_mode text not null default 'manual';

alter table public.booking_settings
drop constraint if exists booking_settings_ticket_creation_mode_check;

alter table public.booking_settings
add constraint booking_settings_ticket_creation_mode_check check (
  ticket_creation_mode in ('manual', 'on_check_in', 'on_service_start')
);

alter table public.pos_tickets
add column if not exists source_booking_id uuid references public.bookings(id) on delete set null;

create unique index if not exists pos_tickets_source_booking_uidx
on public.pos_tickets(source_booking_id)
where source_booking_id is not null;

create index if not exists pos_tickets_source_booking_idx
on public.pos_tickets(source_booking_id)
where source_booking_id is not null;

alter table public.pos_ticket_items
add column if not exists source_booking_id uuid references public.bookings(id) on delete set null,
add column if not exists source_booking_line_id uuid references public.booking_lines(id) on delete set null,
add column if not exists source_kind text not null default 'manual',
add column if not exists service_name_snapshot text,
add column if not exists service_category_snapshot text,
add column if not exists booked_unit_price_snapshot numeric(10,2),
add column if not exists performed_by_staff_id uuid references public.staff(id) on delete set null;

alter table public.pos_ticket_items
drop constraint if exists pos_ticket_items_source_kind_check;

alter table public.pos_ticket_items
add constraint pos_ticket_items_source_kind_check check (
  source_kind in ('manual', 'booking')
);

create unique index if not exists pos_ticket_items_source_booking_line_uidx
on public.pos_ticket_items(source_booking_line_id)
where source_booking_line_id is not null and is_removed = false;

create index if not exists pos_ticket_items_source_booking_idx
on public.pos_ticket_items(source_booking_id, source_booking_line_id)
where source_booking_id is not null;

create index if not exists pos_ticket_items_performed_by_staff_idx
on public.pos_ticket_items(performed_by_staff_id)
where performed_by_staff_id is not null;

create unique index if not exists booking_status_events_converted_to_ticket_uidx
on public.booking_status_events(booking_id)
where event_type = 'converted_to_ticket';

alter table public.pos_ticket_audit_logs
drop constraint if exists pos_ticket_audit_logs_action_check;

alter table public.pos_ticket_audit_logs
add constraint pos_ticket_audit_logs_action_check check (
  action in (
    'ticket_cancelled',
    'ticket_voided',
    'ticket_reopened',
    'ticket_checked_out',
    'ticket_created_from_booking'
  )
);

create or replace function public.normalize_customer_contact_phone(input text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    case
      when btrim(coalesce(input, '')) like '+%' then
        '+' || regexp_replace(coalesce(input, ''), '[^0-9]+', '', 'g')
      else regexp_replace(coalesce(input, ''), '[^0-9]+', '', 'g')
    end,
    ''
  )
$$;

create or replace function public.normalize_customer_contact_email(input text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(lower(btrim(coalesce(input, ''))), '')
$$;

create or replace function public.user_can_convert_booking_to_ticket(
  target_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct permissions.code) = 2
  from public.organization_memberships
  join public.role_permissions
    on role_permissions.role_id = organization_memberships.role_id
  join public.permissions
    on permissions.id = role_permissions.permission_id
  where organization_memberships.organization_id = target_organization_id
    and organization_memberships.user_id = public.current_public_user_id()
    and organization_memberships.status = 'active'
    and permissions.code = any(
      array['bookings.manage', 'tickets.manage']::text[]
    )
$$;

create or replace function public.link_customer_user_from_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.customer_user_id is null then
    return new;
  end if;

  update public.customers
  set customer_user_id = new.customer_user_id,
      source = case
        when source = 'manual' then 'account_link'
        else source
      end,
      updated_by_user_id = coalesce(new.updated_by_user_id, new.created_by_user_id, updated_by_user_id),
      updated_at = now()
  where id = new.customer_id
    and location_id = new.salon_id
    and (
      customer_user_id is null
      or customer_user_id = new.customer_user_id
    );

  return new;
end;
$$;

drop trigger if exists link_customer_user_from_booking on public.bookings;

create trigger link_customer_user_from_booking
after insert or update of customer_user_id, customer_id
on public.bookings
for each row
execute function public.link_customer_user_from_booking();

create or replace function public.validate_pos_ticket_booking_source_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.source_booking_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.bookings
    where bookings.id = new.source_booking_id
      and bookings.organization_id = new.organization_id
      and bookings.salon_id = new.salon_id
      and bookings.customer_id = new.customer_id
  ) then
    raise exception 'Source booking must belong to the same POS ticket salon and customer.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_pos_ticket_booking_source_scope
on public.pos_tickets;

create trigger validate_pos_ticket_booking_source_scope
before insert or update of source_booking_id, organization_id, salon_id, customer_id
on public.pos_tickets
for each row
execute function public.validate_pos_ticket_booking_source_scope();

create or replace function public.validate_pos_ticket_item_booking_source_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.source_booking_id is null and new.source_booking_line_id is null then
    return new;
  end if;

  if new.source_booking_id is null or new.source_booking_line_id is null then
    raise exception 'Booking-sourced POS ticket items require booking and booking line references.';
  end if;

  if not exists (
    select 1
    from public.pos_tickets
    where pos_tickets.id = new.pos_ticket_id
      and pos_tickets.organization_id = new.organization_id
      and pos_tickets.salon_id = new.salon_id
      and pos_tickets.source_booking_id = new.source_booking_id
  ) then
    raise exception 'Booking-sourced POS ticket item must belong to the converted ticket.';
  end if;

  if not exists (
    select 1
    from public.booking_lines
    where booking_lines.id = new.source_booking_line_id
      and booking_lines.booking_id = new.source_booking_id
      and booking_lines.organization_id = new.organization_id
      and booking_lines.salon_id = new.salon_id
  ) then
    raise exception 'Source booking line must belong to the source booking.';
  end if;

  if new.performed_by_staff_id is not null and not exists (
    select 1
    from public.staff
    where staff.id = new.performed_by_staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'Performed-by staff must belong to the ticket salon.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_pos_ticket_item_booking_source_scope
on public.pos_ticket_items;

create trigger validate_pos_ticket_item_booking_source_scope
before insert or update of source_booking_id, source_booking_line_id, performed_by_staff_id, organization_id, salon_id, pos_ticket_id
on public.pos_ticket_items
for each row
execute function public.validate_pos_ticket_item_booking_source_scope();

create or replace function public.sync_pos_ticket_item_performed_staff_from_booking_line()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.line_status = 'completed'
    and new.performed_by_staff_id is not null
    and (
      old.line_status is distinct from new.line_status
      or old.performed_by_staff_id is distinct from new.performed_by_staff_id
    )
  then
    update public.pos_ticket_items
    set performed_by_staff_id = new.performed_by_staff_id,
        assigned_staff_id = coalesce(assigned_staff_id, new.performed_by_staff_id),
        updated_at = now()
    where source_booking_line_id = new.id
      and source_booking_id = new.booking_id
      and organization_id = new.organization_id
      and salon_id = new.salon_id
      and is_removed = false;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_pos_ticket_item_performed_staff_from_booking_line
on public.booking_lines;

create trigger sync_pos_ticket_item_performed_staff_from_booking_line
after update of line_status, performed_by_staff_id
on public.booking_lines
for each row
execute function public.sync_pos_ticket_item_performed_staff_from_booking_line();

create or replace function public.convert_booking_to_pos_ticket(
  p_booking_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid;
  booking_row public.bookings%rowtype;
  existing_ticket_id uuid;
  inserted_item_id uuid;
  line_row public.booking_lines%rowtype;
  now_value timestamptz := now();
  performed_staff_id uuid;
  ticket_id uuid;
  work_date date;
begin
  if p_booking_id is null then
    raise exception 'Booking id is required.';
  end if;

  actor_user_id := public.current_public_user_id();

  if actor_user_id is null then
    raise exception 'Sign in required.';
  end if;

  select *
  into booking_row
  from public.bookings
  where id = p_booking_id
  for update;

  if booking_row.id is null then
    raise exception 'Booking was not found.';
  end if;

  if not public.user_can_convert_booking_to_ticket(booking_row.organization_id) then
    raise exception 'You do not have permission to create POS tickets from bookings.';
  end if;

  if booking_row.pos_ticket_id is not null then
    return booking_row.pos_ticket_id;
  end if;

  select pos_tickets.id
  into existing_ticket_id
  from public.pos_tickets
  where pos_tickets.source_booking_id = booking_row.id
  for update;

  if existing_ticket_id is not null then
    update public.bookings
    set pos_ticket_id = existing_ticket_id,
        updated_by_user_id = actor_user_id,
        updated_at = now()
    where id = booking_row.id;

    return existing_ticket_id;
  end if;

  if public.normalize_booking_status(booking_row.status) in ('pending', 'cancelled', 'no_show') then
    raise exception 'Only confirmed, checked-in, in-service, or completed bookings can be converted to POS tickets.';
  end if;

  if booking_row.confirmation_status in ('requested', 'cancelled', 'declined') then
    raise exception 'Booking must be confirmed before creating a POS ticket.';
  end if;

  if not exists (
    select 1
    from public.booking_lines
    where booking_id = booking_row.id
      and salon_id = booking_row.salon_id
      and line_status <> 'cancelled'
  ) then
    raise exception 'Booking has no active lines to convert.';
  end if;

  insert into public.pos_tickets (
    organization_id,
    salon_id,
    customer_id,
    opened_at,
    status,
    notes,
    source_booking_id
  )
  values (
    booking_row.organization_id,
    booking_row.salon_id,
    booking_row.customer_id,
    now_value,
    'open',
    'Created from booking ' || booking_row.id::text,
    booking_row.id
  )
  returning id into ticket_id;

  work_date := (now_value at time zone coalesce(booking_row.salon_timezone_snapshot, 'America/Chicago'))::date;

  for line_row in
    select *
    from public.booking_lines
    where booking_id = booking_row.id
      and salon_id = booking_row.salon_id
      and line_status <> 'cancelled'
    order by display_order, created_at, id
  loop
    performed_staff_id := coalesce(line_row.performed_by_staff_id, line_row.assigned_staff_id, booking_row.staff_id);

    insert into public.pos_ticket_items (
      organization_id,
      salon_id,
      pos_ticket_id,
      service_id,
      assigned_staff_id,
      quantity,
      unit_price,
      notes,
      source_booking_id,
      source_booking_line_id,
      source_kind,
      service_name_snapshot,
      service_category_snapshot,
      booked_unit_price_snapshot,
      performed_by_staff_id
    )
    values (
      line_row.organization_id,
      line_row.salon_id,
      ticket_id,
      line_row.service_id,
      performed_staff_id,
      line_row.quantity,
      line_row.unit_price,
      case
        when line_row.line_type = 'add_on' then 'Booking add-on'
        else 'Booking service'
      end,
      booking_row.id,
      line_row.id,
      'booking',
      line_row.service_name_snapshot,
      line_row.service_category_snapshot,
      line_row.unit_price,
      performed_staff_id
    )
    returning id into inserted_item_id;

    if performed_staff_id is not null and line_row.unit_price > 0 then
      insert into public.pos_ticket_item_turn_parts (
        organization_id,
        salon_id,
        ticket_id,
        ticket_item_id,
        staff_id,
        amount,
        turn_type,
        turn_index,
        work_date
      )
      values (
        line_row.organization_id,
        line_row.salon_id,
        ticket_id,
        inserted_item_id,
        performed_staff_id,
        line_row.unit_price * line_row.quantity,
        case when line_row.unit_price * line_row.quantity >= 25 then 'large' else 'small' end,
        1,
        work_date
      );
    end if;
  end loop;

  update public.bookings
  set pos_ticket_id = ticket_id,
      payment_status = case
        when payment_status = 'not_required' then 'pending'
        else payment_status
      end,
      updated_by_user_id = actor_user_id,
      updated_at = now()
  where id = booking_row.id;

  insert into public.booking_status_events (
    organization_id,
    salon_id,
    booking_id,
    event_type,
    old_status,
    new_status,
    actor_user_id,
    actor_source,
    metadata
  )
  values (
    booking_row.organization_id,
    booking_row.salon_id,
    booking_row.id,
    'converted_to_ticket',
    booking_row.status,
    booking_row.status,
    actor_user_id,
    'manager',
    jsonb_build_object('pos_ticket_id', ticket_id)
  )
  on conflict do nothing;

  insert into public.pos_ticket_audit_logs (
    organization_id,
    salon_id,
    ticket_id,
    action,
    note,
    created_by
  )
  values (
    booking_row.organization_id,
    booking_row.salon_id,
    ticket_id,
    'ticket_created_from_booking',
    'Created from booking ' || booking_row.id::text,
    actor_user_id
  );

  return ticket_id;
exception
  when unique_violation then
    select coalesce(bookings.pos_ticket_id, pos_tickets.id)
    into existing_ticket_id
    from public.bookings
    left join public.pos_tickets
      on pos_tickets.source_booking_id = bookings.id
    where bookings.id = p_booking_id;

    if existing_ticket_id is not null then
      return existing_ticket_id;
    end if;

    raise;
end;
$$;

revoke all on function public.normalize_customer_contact_phone(text) from public, anon, authenticated;
grant execute on function public.normalize_customer_contact_phone(text) to authenticated;

revoke all on function public.normalize_customer_contact_email(text) from public, anon, authenticated;
grant execute on function public.normalize_customer_contact_email(text) to authenticated;

revoke all on function public.user_can_convert_booking_to_ticket(uuid) from public, anon;
grant execute on function public.user_can_convert_booking_to_ticket(uuid) to authenticated;

revoke all on function public.convert_booking_to_pos_ticket(uuid) from public, anon;
grant execute on function public.convert_booking_to_pos_ticket(uuid) to authenticated;
