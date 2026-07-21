alter table public.pos_desk_sessions
drop constraint if exists pos_desk_sessions_status_check;

alter table public.pos_desk_sessions
add constraint pos_desk_sessions_status_check check (
  status in ('active', 'pending_confirmation', 'submitted', 'cancelled', 'expired')
);

create or replace function public.get_pos_desk_session_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.pos_desk_sessions%rowtype;
  lines_json jsonb;
begin
  select *
  into session_row
  from public.pos_desk_sessions
  where customer_display_token = p_token
  limit 1;

  if session_row.id is null then
    return null;
  end if;

  if session_row.status in ('active', 'pending_confirmation') and session_row.expires_at <= now() then
    update public.pos_desk_sessions
    set status = 'expired',
        last_activity_at = now()
    where id = session_row.id
    returning * into session_row;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', pos_desk_session_lines.id,
        'staff_id', pos_desk_session_lines.staff_id,
        'staff_name', staff.display_name,
        'service_id', pos_desk_session_lines.service_id,
        'service_label', pos_desk_session_lines.service_label,
        'amount', pos_desk_session_lines.amount,
        'amount_input', pos_desk_session_lines.amount_input,
        'amount_parts', pos_desk_session_lines.amount_parts,
        'turn_large_count', pos_desk_session_lines.turn_large_count,
        'turn_small_count', pos_desk_session_lines.turn_small_count,
        'sort_order', pos_desk_session_lines.sort_order
      )
      order by pos_desk_session_lines.sort_order, pos_desk_session_lines.created_at
    ),
    '[]'::jsonb
  )
  into lines_json
  from public.pos_desk_session_lines
  left join public.staff on staff.id = pos_desk_session_lines.staff_id
  where pos_desk_session_lines.session_id = session_row.id;

  return jsonb_build_object(
    'id', session_row.id,
    'salon_id', session_row.salon_id,
    'salon_name', (select locations.name from public.locations where locations.id = session_row.salon_id),
    'customer_id', session_row.customer_id,
    'customer_lookup_value', session_row.customer_lookup_value,
    'customer_name_snapshot', session_row.customer_name_snapshot,
    'note', session_row.note,
    'status', session_row.status,
    'tip_amount', session_row.tip_amount,
    'customer_confirmed_at', session_row.customer_confirmed_at,
    'submitted_ticket_id', session_row.submitted_ticket_id,
    'customer_display_token', session_row.customer_display_token,
    'expires_at', session_row.expires_at,
    'updated_at', session_row.updated_at,
    'lines', lines_json
  );
end;
$$;

create or replace function public.update_pos_desk_session_tip_by_token(
  p_token text,
  p_tip_amount numeric,
  p_confirm boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_id uuid;
begin
  if p_tip_amount < 0 then
    raise exception 'Tip must be zero or greater.';
  end if;

  update public.pos_desk_sessions
  set tip_amount = round(p_tip_amount, 2),
      customer_confirmed_at = case when p_confirm then now() else customer_confirmed_at end,
      last_activity_at = now(),
      expires_at = now() + interval '10 minutes'
  where customer_display_token = p_token
    and status in ('active', 'pending_confirmation')
    and customer_confirmed_at is null
    and expires_at > now()
  returning id into updated_id;

  if updated_id is null then
    return null;
  end if;

  return public.get_pos_desk_session_by_token(p_token);
end;
$$;

grant execute on function public.get_pos_desk_session_by_token(text) to anon, authenticated;
grant execute on function public.update_pos_desk_session_tip_by_token(text, numeric, boolean) to anon, authenticated;

create or replace function public.update_pos_desk_session_customer_by_token(
  p_token text,
  p_customer_lookup text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lookup_value text := nullif(btrim(p_customer_lookup), '');
  matched_customer public.customers%rowtype;
  target_salon_id uuid;
  updated_id uuid;
begin
  select salon_id
  into target_salon_id
  from public.pos_desk_sessions
  where customer_display_token = p_token
    and status in ('active', 'pending_confirmation')
    and expires_at > now()
  limit 1;

  if target_salon_id is null then
    return null;
  end if;

  if lookup_value is not null then
    select *
    into matched_customer
    from public.customers
    where status = 'active'
      and location_id = target_salon_id
      and (
        phone = lookup_value
        or lower(email) = lower(lookup_value)
        or lower(btrim(name)) = lower(lookup_value)
      )
    order by created_at desc
    limit 1;
  end if;

  update public.pos_desk_sessions
  set customer_id = matched_customer.id,
      customer_lookup_value = lookup_value,
      customer_name_snapshot = case
        when matched_customer.id is not null then matched_customer.name
        else lookup_value
      end,
      last_activity_at = now(),
      expires_at = now() + interval '10 minutes'
  where customer_display_token = p_token
    and status in ('active', 'pending_confirmation')
    and expires_at > now()
  returning id into updated_id;

  if updated_id is null then
    return null;
  end if;

  return public.get_pos_desk_session_by_token(p_token);
end;
$$;

create or replace function public.create_pos_desk_customer_by_token(
  p_token text,
  p_customer_name text,
  p_customer_lookup text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lookup_value text := nullif(btrim(p_customer_lookup), '');
  new_customer public.customers%rowtype;
  session_row public.pos_desk_sessions%rowtype;
begin
  select *
  into session_row
  from public.pos_desk_sessions
  where customer_display_token = p_token
    and status in ('active', 'pending_confirmation')
    and expires_at > now()
  limit 1;

  if session_row.id is null then
    return null;
  end if;

  if nullif(btrim(p_customer_name), '') is null then
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
    case when lookup_value like '%@%' then lookup_value else null end,
    session_row.salon_id,
    btrim(p_customer_name),
    'Created from POS customer display.',
    case when lookup_value is not null and lookup_value not like '%@%' then lookup_value else null end,
    'active'
  )
  returning * into new_customer;

  update public.pos_desk_sessions
  set customer_id = new_customer.id,
      customer_lookup_value = lookup_value,
      customer_name_snapshot = new_customer.name,
      last_activity_at = now(),
      expires_at = now() + interval '10 minutes'
  where id = session_row.id;

  return public.get_pos_desk_session_by_token(p_token);
end;
$$;

grant execute on function public.update_pos_desk_session_customer_by_token(text, text) to anon, authenticated;
grant execute on function public.create_pos_desk_customer_by_token(text, text, text) to anon, authenticated;
