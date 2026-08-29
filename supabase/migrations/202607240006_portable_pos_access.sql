create extension if not exists pgcrypto;

create table if not exists public.pos_portable_access_keys (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  access_id text not null,
  passcode_salt text not null,
  passcode_digest text not null,
  label text,
  is_active boolean not null default true,
  last_used_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_portable_access_keys_access_id_not_blank check (length(btrim(access_id)) > 0),
  constraint pos_portable_access_keys_passcode_salt_not_blank check (length(btrim(passcode_salt)) > 0),
  constraint pos_portable_access_keys_passcode_digest_not_blank check (length(btrim(passcode_digest)) > 0)
);

create unique index if not exists pos_portable_access_keys_access_id_uidx
on public.pos_portable_access_keys(lower(btrim(access_id)));

create index if not exists pos_portable_access_keys_salon_idx
on public.pos_portable_access_keys(salon_id, is_active, created_at desc);

drop trigger if exists set_pos_portable_access_keys_updated_at
on public.pos_portable_access_keys;

create trigger set_pos_portable_access_keys_updated_at
before update on public.pos_portable_access_keys
for each row execute function public.set_updated_at();

alter table public.pos_portable_access_keys enable row level security;

drop policy if exists "salon_member_read_portable_pos_access"
on public.pos_portable_access_keys;

create policy "salon_member_read_portable_pos_access"
on public.pos_portable_access_keys
for select to authenticated
using (
  public.user_has_salon_permission(
    salon_id,
    array['salon_settings.view', 'salon_settings.manage', 'tickets.manage']
  )
);

drop policy if exists "salon_manager_write_portable_pos_access"
on public.pos_portable_access_keys;

create policy "salon_manager_write_portable_pos_access"
on public.pos_portable_access_keys
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['salon_settings.manage']))
with check (public.user_has_salon_permission(salon_id, array['salon_settings.manage']));

grant select, insert, update, delete on table public.pos_portable_access_keys
to authenticated;

create or replace function public.pos_portable_access_signature(
  p_key_id uuid,
  p_passcode_digest text
)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(
    extensions.hmac(
      p_key_id::text,
      p_passcode_digest,
      'sha256'
    ),
    'hex'
  )
$$;

create or replace function public.pos_portable_access_salon_id(
  p_key_id uuid,
  p_session_signature text
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select access_keys.salon_id
  from public.pos_portable_access_keys access_keys
  where access_keys.id = p_key_id
    and access_keys.is_active = true
    and p_session_signature = public.pos_portable_access_signature(
      access_keys.id,
      access_keys.passcode_digest
    )
  limit 1
$$;

create or replace function public.sign_in_pos_portable_access(
  p_access_id text,
  p_passcode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  access_query text := lower(btrim(coalesce(p_access_id, '')));
  passcode_value text := btrim(coalesce(p_passcode, ''));
  expected_digest text;
  key_row public.pos_portable_access_keys%rowtype;
  salon_name text;
begin
  if access_query = '' or passcode_value = '' then
    return null;
  end if;

  select access_keys.*
  into key_row
  from public.pos_portable_access_keys access_keys
  join public.locations on locations.id = access_keys.salon_id
  where lower(btrim(access_keys.access_id)) = access_query
    and access_keys.is_active = true
    and locations.status = 'active'
  limit 1;

  if key_row.id is null then
    return null;
  end if;

  select locations.name
  into salon_name
  from public.locations
  where locations.id = key_row.salon_id
  limit 1;

  expected_digest := encode(
    extensions.digest(
      access_query || ':' || passcode_value || ':' || key_row.passcode_salt,
      'sha256'
    ),
    'hex'
  );

  if expected_digest <> key_row.passcode_digest then
    return null;
  end if;

  update public.pos_portable_access_keys
  set last_used_at = now()
  where id = key_row.id;

  return jsonb_build_object(
    'key_id', key_row.id,
    'access_id', key_row.access_id,
    'salon_id', key_row.salon_id,
    'salon_name', salon_name,
    'signature', public.pos_portable_access_signature(key_row.id, key_row.passcode_digest)
  );
end;
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
    'salon_id', context_row.salon_id,
    'salon_name', context_row.salon_name
  );
end;
$$;

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
  target_salon_id uuid;
  salon_name text;
  services_json jsonb;
  staff_json jsonb;
  draft_row public.pos_live_drafts%rowtype;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null then
    return null;
  end if;

  select locations.name
  into salon_name
  from public.locations
  where locations.id = target_salon_id
  limit 1;

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

  with turn_counts as (
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
        'turns', jsonb_build_object(
          'largeTurns', coalesce(turn_counts.large_turns, 0),
          'smallTurns', coalesce(turn_counts.small_turns, 0),
          'totalTurns', coalesce(turn_counts.total_turns, 0)
        )
      )
      order by
        coalesce(turn_counts.total_turns, 0),
        coalesce(turn_counts.large_turns, 0),
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
  left join turn_counts on turn_counts.staff_id = staff.id
  where staff.salon_id = target_salon_id
    and staff.is_active = true
    and staff.pos_enabled = true;

  select *
  into draft_row
  from public.pos_live_drafts
  where salon_id = target_salon_id
    and status = 'draft'
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
      total
    )
    values (
      '{}'::jsonb,
      target_salon_id,
      '[]'::jsonb,
      0,
      0,
      replace(gen_random_uuid()::text, '-', ''),
      0
    )
    returning * into draft_row;
  end if;

  return jsonb_build_object(
    'salonName', salon_name,
    'services', services_json,
    'staff', staff_json,
    'liveDraft', jsonb_build_object(
      'id', draft_row.id,
      'salon_id', draft_row.salon_id,
      'token', draft_row.token,
      'customer', draft_row.customer,
      'staff_lines', draft_row.staff_lines,
      'selected_staff_id', draft_row.selected_staff_id,
      'tip', draft_row.tip,
      'subtotal', draft_row.subtotal,
      'total', draft_row.total,
      'status', draft_row.status,
      'version', draft_row.version,
      'updated_at', draft_row.updated_at
    )
  );
end;
$$;

create or replace function public.search_pos_portable_customers(
  p_key_id uuid,
  p_session_signature text,
  p_search text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_salon_id uuid;
  search_query text := btrim(coalesce(p_search, ''));
  customers_json jsonb;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null then
    return null;
  end if;

  if search_query = '' then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', customers.id,
        'name', customers.name,
        'phone', customers.phone,
        'email', customers.email
      )
      order by customers.created_at desc
    ),
    '[]'::jsonb
  )
  into customers_json
  from (
    select *
    from public.customers
    where customers.location_id = target_salon_id
      and customers.status = 'active'
      and (
        customers.name ilike '%' || search_query || '%'
        or customers.phone ilike '%' || search_query || '%'
        or customers.email ilike '%' || search_query || '%'
      )
    order by customers.created_at desc
    limit 10
  ) customers;

  return customers_json;
end;
$$;

create or replace function public.create_pos_portable_customer(
  p_key_id uuid,
  p_session_signature text,
  p_name text,
  p_phone text default null,
  p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_salon_id uuid;
  customer_row public.customers%rowtype;
  normalized_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null then
    return null;
  end if;

  if normalized_name is null then
    raise exception 'Customer name is required.';
  end if;

  insert into public.customers (
    email,
    location_id,
    name,
    notes,
    phone,
    status
  )
  values (
    nullif(btrim(coalesce(p_email, '')), ''),
    target_salon_id,
    normalized_name,
    'Created from Portable POS quick add.',
    nullif(btrim(coalesce(p_phone, '')), ''),
    'active'
  )
  returning * into customer_row;

  return jsonb_build_object(
    'id', customer_row.id,
    'name', customer_row.name,
    'phone', customer_row.phone,
    'email', customer_row.email
  );
end;
$$;

create or replace function public.update_pos_portable_live_draft(
  p_key_id uuid,
  p_session_signature text,
  p_token text,
  p_selected_staff_id text,
  p_staff_lines jsonb,
  p_subtotal numeric,
  p_tip numeric,
  p_total numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_salon_id uuid;
  draft_row public.pos_live_drafts%rowtype;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null then
    return null;
  end if;

  if jsonb_typeof(coalesce(p_staff_lines, '[]'::jsonb)) <> 'array' then
    raise exception 'Staff lines must be an array.';
  end if;

  select *
  into draft_row
  from public.pos_live_drafts
  where token = p_token
    and salon_id = target_salon_id
  limit 1;

  if draft_row.id is null then
    raise exception 'Live draft was not found.';
  end if;

  update public.pos_live_drafts
  set selected_staff_id = nullif(btrim(coalesce(p_selected_staff_id, '')), ''),
      staff_lines = coalesce(p_staff_lines, '[]'::jsonb),
      status = 'draft',
      subtotal = round(coalesce(p_subtotal, 0), 2),
      tip = round(coalesce(p_tip, 0), 2),
      total = round(coalesce(p_total, 0), 2),
      version = version + 1
  where id = draft_row.id
  returning * into draft_row;

  return jsonb_build_object(
    'id', draft_row.id,
    'salon_id', draft_row.salon_id,
    'token', draft_row.token,
    'customer', draft_row.customer,
    'staff_lines', draft_row.staff_lines,
    'selected_staff_id', draft_row.selected_staff_id,
    'tip', draft_row.tip,
    'subtotal', draft_row.subtotal,
    'total', draft_row.total,
    'status', draft_row.status,
    'version', draft_row.version,
    'updated_at', draft_row.updated_at
  );
end;
$$;

create or replace function public.update_pos_portable_live_draft_customer(
  p_key_id uuid,
  p_session_signature text,
  p_token text,
  p_customer jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_salon_id uuid;
  draft_row public.pos_live_drafts%rowtype;
  customer_id_text text;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null then
    return null;
  end if;

  if p_customer is not null and jsonb_typeof(p_customer) <> 'null' then
    customer_id_text := nullif(btrim(coalesce(p_customer ->> 'id', '')), '');

    if customer_id_text is not null and not exists (
      select 1
      from public.customers
      where customers.id = customer_id_text::uuid
        and customers.location_id = target_salon_id
    ) then
      raise exception 'Selected customer must belong to the current salon.';
    end if;
  end if;

  update public.pos_live_drafts
  set customer = case
        when p_customer is null or jsonb_typeof(p_customer) = 'null' then null
        else p_customer
      end,
      version = version + 1
  where token = p_token
    and salon_id = target_salon_id
  returning * into draft_row;

  if draft_row.id is null then
    raise exception 'Live draft was not found.';
  end if;

  return jsonb_build_object(
    'id', draft_row.id,
    'salon_id', draft_row.salon_id,
    'token', draft_row.token,
    'customer', draft_row.customer,
    'staff_lines', draft_row.staff_lines,
    'selected_staff_id', draft_row.selected_staff_id,
    'tip', draft_row.tip,
    'subtotal', draft_row.subtotal,
    'total', draft_row.total,
    'status', draft_row.status,
    'version', draft_row.version,
    'updated_at', draft_row.updated_at
  );
end;
$$;

create or replace function public.submit_pos_portable_receipt(
  p_key_id uuid,
  p_session_signature text,
  p_receipt jsonb,
  p_work_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_salon_id uuid;
  access_label text;
  customer_id_text text;
  customer_lookup text;
  customer_name text;
  customer_row public.customers%rowtype;
  discount_amount numeric := 0;
  discount_type text;
  discount_value numeric;
  line_item jsonb;
  line_total numeric;
  lines_json jsonb;
  next_sequence integer;
  part_amount numeric;
  part_index integer;
  part_value jsonb;
  payment_total numeric;
  service_id_text text;
  service_uuid uuid;
  staff_uuid uuid;
  subtotal numeric := 0;
  ticket_item_id uuid;
  ticket_row public.pos_tickets%rowtype;
  tip_amount numeric;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null then
    return null;
  end if;

  select access_id
  into access_label
  from public.pos_portable_access_keys
  where id = p_key_id;

  lines_json := p_receipt -> 'lines';

  if jsonb_typeof(coalesce(lines_json, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(lines_json, '[]'::jsonb)) = 0
  then
    raise exception 'Add at least one receipt line before submit.';
  end if;

  for line_item in select value from jsonb_array_elements(lines_json)
  loop
    line_total := round(coalesce((line_item ->> 'total')::numeric, 0), 2);

    if line_total <= 0 then
      raise exception 'Every receipt line needs a positive amount.';
    end if;

    subtotal := subtotal + line_total;
  end loop;

  customer_id_text := nullif(btrim(coalesce(p_receipt ->> 'customerId', '')), '');
  customer_lookup := nullif(btrim(coalesce(p_receipt ->> 'customerLookup', '')), '');
  customer_name := nullif(btrim(coalesce(p_receipt ->> 'customerName', '')), '');

  if customer_id_text is not null then
    select *
    into customer_row
    from public.customers
    where customers.id = customer_id_text::uuid
      and customers.location_id = target_salon_id
    limit 1;

    if customer_row.id is null then
      raise exception 'Selected customer must belong to the current salon.';
    end if;
  end if;

  if customer_row.id is null and customer_lookup is not null then
    select *
    into customer_row
    from public.customers
    where customers.location_id = target_salon_id
      and customers.status = 'active'
      and (
        customers.phone = customer_lookup
        or lower(customers.email) = lower(customer_lookup)
        or lower(btrim(customers.name)) = lower(customer_lookup)
      )
    order by customers.created_at desc
    limit 1;
  end if;

  if customer_row.id is null then
    insert into public.customers (
      email,
      location_id,
      name,
      notes,
      phone,
      status
    )
    values (
      case when customer_lookup like '%@%' then customer_lookup else null end,
      target_salon_id,
      coalesce(customer_name, customer_lookup, 'Walk-in Customer'),
      'Created from Portable POS.',
      case
        when customer_lookup is not null and customer_lookup not like '%@%' then customer_lookup
        else null
      end,
      'active'
    )
    returning * into customer_row;
  end if;

  discount_type := case
    when p_receipt ->> 'discountType' = 'percentage' then 'percentage'
    else 'fixed_amount'
  end;
  discount_value := round(greatest(coalesce((p_receipt ->> 'discountValue')::numeric, 0), 0), 2);
  tip_amount := round(greatest(coalesce((p_receipt ->> 'tipAmount')::numeric, 0), 0), 2);

  discount_amount := case
    when subtotal <= 0 or discount_value <= 0 then 0
    when discount_type = 'percentage' then least(subtotal, round((subtotal * discount_value) / 100, 2))
    else least(subtotal, discount_value)
  end;
  payment_total := round(subtotal - discount_amount + tip_amount, 2);

  if payment_total <= 0 then
    raise exception 'Receipt total must be greater than 0.';
  end if;

  select coalesce(max(ticket_sequence), 0) + 1
  into next_sequence
  from public.pos_tickets
  where salon_id = target_salon_id;

  insert into public.pos_tickets (
    customer_id,
    closed_at,
    discount_type,
    discount_value,
    notes,
    opened_at,
    salon_id,
    status,
    tax_rate,
    ticket_number,
    ticket_sequence,
    tip_type,
    tip_value
  )
  values (
    customer_row.id,
    now(),
    discount_type,
    discount_value,
    nullif(btrim(coalesce(p_receipt ->> 'note', '')), ''),
    now(),
    target_salon_id,
    'closed',
    0,
    'T' || lpad(next_sequence::text, 5, '0'),
    next_sequence,
    'fixed_amount',
    tip_amount
  )
  returning * into ticket_row;

  for line_item in select value from jsonb_array_elements(lines_json)
  loop
    line_total := round(coalesce((line_item ->> 'total')::numeric, 0), 2);
    staff_uuid := (line_item ->> 'staffId')::uuid;
    service_id_text := nullif(btrim(coalesce(line_item ->> 'serviceId', '')), '');
    service_uuid := case when service_id_text is null then null else service_id_text::uuid end;

    if not exists (
      select 1
      from public.staff
      where staff.id = staff_uuid
        and staff.salon_id = target_salon_id
        and staff.is_active = true
        and staff.pos_enabled = true
    ) then
      raise exception 'Assigned staff must be active and enabled for POS.';
    end if;

    if service_uuid is not null and not exists (
      select 1
      from public.services
      where services.id = service_uuid
        and services.salon_id = target_salon_id
        and services.is_active = true
    ) then
      raise exception 'Selected services must be active in the current salon.';
    end if;

    insert into public.pos_ticket_items (
      assigned_staff_id,
      line_total,
      notes,
      pos_ticket_id,
      quantity,
      salon_id,
      service_id,
      unit_price
    )
    values (
      staff_uuid,
      line_total,
      coalesce(nullif(btrim(line_item ->> 'serviceLabel'), ''), 'Service')
        || ' | Parts: '
        || coalesce(line_item ->> 'amountInput', ''),
      ticket_row.id,
      1,
      target_salon_id,
      service_uuid,
      line_total
    )
    returning id into ticket_item_id;

    if jsonb_typeof(coalesce(line_item -> 'amountParts', '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(line_item -> 'amountParts', '[]'::jsonb)) = 0
    then
      raise exception 'Every receipt line needs amount parts.';
    end if;

    part_index := 0;
    for part_value in select value from jsonb_array_elements(line_item -> 'amountParts')
    loop
      part_index := part_index + 1;
      part_amount := round((part_value #>> '{}')::numeric, 2);

      insert into public.pos_ticket_item_turn_parts (
        amount,
        salon_id,
        staff_id,
        ticket_id,
        ticket_item_id,
        turn_index,
        turn_type,
        work_date
      )
      values (
        part_amount,
        target_salon_id,
        staff_uuid,
        ticket_row.id,
        ticket_item_id,
        part_index,
        case when part_amount >= 25 then 'large' else 'small' end,
        p_work_date
      );
    end loop;
  end loop;

  insert into public.pos_payments (
    amount,
    note,
    payment_method,
    salon_id,
    ticket_id
  )
  values (
    payment_total,
    'Record-only Portable POS payment.',
    'other',
    target_salon_id,
    ticket_row.id
  );

  insert into public.pos_ticket_audit_logs (
    action,
    note,
    salon_id,
    ticket_id
  )
  values (
    'ticket_checked_out',
    'Ticket checked out from Portable POS: ' || coalesce(access_label, p_key_id::text) || '.',
    target_salon_id,
    ticket_row.id
  );

  return jsonb_build_object(
    'ok', true,
    'salonId', target_salon_id,
    'ticketId', ticket_row.id,
    'ticketNumber', ticket_row.ticket_number,
    'workDate', p_work_date
  );
end;
$$;

grant execute on function public.sign_in_pos_portable_access(text, text) to anon, authenticated;
grant execute on function public.get_pos_portable_access_context(uuid, text) to anon, authenticated;
grant execute on function public.get_pos_portable_desk_data(uuid, text, date) to anon, authenticated;
grant execute on function public.search_pos_portable_customers(uuid, text, text) to anon, authenticated;
grant execute on function public.create_pos_portable_customer(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.update_pos_portable_live_draft(uuid, text, text, text, jsonb, numeric, numeric, numeric) to anon, authenticated;
grant execute on function public.update_pos_portable_live_draft_customer(uuid, text, text, jsonb) to anon, authenticated;
grant execute on function public.submit_pos_portable_receipt(uuid, text, jsonb, date) to anon, authenticated;
