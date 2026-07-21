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
  updated_id uuid;
begin
  if lookup_value is not null then
    select *
    into matched_customer
    from public.customers
    where status = 'active'
      and location_id = (
        select salon_id
        from public.pos_desk_sessions
        where customer_display_token = p_token
          and status = 'active'
          and expires_at > now()
        limit 1
      )
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
      expires_at = now() + interval '5 minutes'
  where customer_display_token = p_token
    and status = 'active'
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
    and status = 'active'
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
      expires_at = now() + interval '5 minutes'
  where id = session_row.id;

  return public.get_pos_desk_session_by_token(p_token);
end;
$$;

grant execute on function public.update_pos_desk_session_customer_by_token(text, text) to anon, authenticated;
grant execute on function public.create_pos_desk_customer_by_token(text, text, text) to anon, authenticated;
