alter table public.pos_live_drafts
  add column if not exists discount numeric not null default 0,
  add column if not exists tax numeric not null default 0,
  add column if not exists total_before_tip numeric not null default 0,
  add column if not exists completed_at timestamptz,
  add column if not exists reset_at timestamptz,
  add column if not exists last_customer_action_id text,
  add column if not exists last_tip_action_id text;

create index if not exists pos_live_drafts_reset_at_idx
on public.pos_live_drafts(reset_at)
where reset_at is not null;

drop function if exists public.get_pos_live_draft_by_token(text);

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

create or replace function public.find_pos_live_draft_customer_by_phone(
  p_phone text,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_row public.pos_live_drafts%rowtype;
  normalized_phone text;
  matched_customer public.customers%rowtype;
begin
  normalized_phone := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');

  if normalized_phone is null then
    raise exception 'Phone is required.';
  end if;

  select *
  into draft_row
  from public.pos_live_drafts
  where token = btrim(coalesce(p_token, ''))
  limit 1;

  if draft_row.id is null then
    raise exception 'Live draft was not found.';
  end if;

  select *
  into matched_customer
  from public.customers
  where location_id = draft_row.salon_id
    and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = normalized_phone
    and status = 'active'
  order by created_at desc
  limit 1;

  if matched_customer.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', matched_customer.id,
    'name', matched_customer.name,
    'phone', matched_customer.phone
  );
end;
$$;

create or replace function public.search_pos_live_draft_customers_by_phone(
  p_token text,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_row public.pos_live_drafts%rowtype;
  normalized_phone text;
  result_json jsonb;
begin
  normalized_phone := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');

  if normalized_phone is null or length(normalized_phone) < 4 then
    return '[]'::jsonb;
  end if;

  select *
  into draft_row
  from public.pos_live_drafts
  where token = btrim(coalesce(p_token, ''))
    and status = 'draft'
  limit 1;

  if draft_row.id is null then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', matched.id,
        'name', matched.name,
        'phone', matched.phone
      )
      order by matched.created_at desc
    ),
    '[]'::jsonb
  )
  into result_json
  from (
    select id, name, phone, created_at
    from public.customers
    where location_id = draft_row.salon_id
      and status = 'active'
      and regexp_replace(coalesce(phone, ''), '\D', '', 'g') like '%' || normalized_phone || '%'
    order by created_at desc
    limit 3
  ) matched;

  return result_json;
end;
$$;

create or replace function public.confirm_pos_live_draft_customer(
  p_token text,
  p_customer_id uuid,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_request_id text := nullif(btrim(coalesce(p_request_id, '')), '');
  draft_row public.pos_live_drafts%rowtype;
  matched_customer public.customers%rowtype;
begin
  select *
  into draft_row
  from public.pos_live_drafts
  where token = btrim(coalesce(p_token, ''))
    and status = 'draft'
  for update;

  if draft_row.id is null then
    return null;
  end if;

  if clean_request_id is not null
    and draft_row.last_customer_action_id = clean_request_id
  then
    return (
      select to_jsonb(snapshot)
      from public.get_pos_live_draft_by_token(p_token) snapshot
      limit 1
    );
  end if;

  select *
  into matched_customer
  from public.customers
  where id = p_customer_id
    and location_id = draft_row.salon_id
    and status = 'active'
  limit 1;

  if matched_customer.id is null then
    raise exception 'Selected customer was not found.';
  end if;

  update public.pos_live_drafts
  set customer = jsonb_build_object(
        'id', matched_customer.id,
        'name', matched_customer.name,
        'phone', matched_customer.phone
      ),
      customer_version = customer_version + 1,
      last_customer_action_id = clean_request_id,
      version = version + 1
  where id = draft_row.id;

  return (
    select to_jsonb(snapshot)
    from public.get_pos_live_draft_by_token(p_token) snapshot
    limit 1
  );
end;
$$;

create or replace function public.confirm_pos_live_draft_tip(
  p_token text,
  p_tip_amount numeric,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_request_id text := nullif(btrim(coalesce(p_request_id, '')), '');
  clean_tip numeric := round(coalesce(p_tip_amount, 0), 2);
  draft_row public.pos_live_drafts%rowtype;
  base_total numeric;
begin
  if clean_tip < 0 then
    raise exception 'Tip must be zero or greater.';
  end if;

  select *
  into draft_row
  from public.pos_live_drafts
  where token = btrim(coalesce(p_token, ''))
    and status = 'draft'
  for update;

  if draft_row.id is null then
    return null;
  end if;

  if clean_request_id is not null
    and draft_row.last_tip_action_id = clean_request_id
  then
    return (
      select to_jsonb(snapshot)
      from public.get_pos_live_draft_by_token(p_token) snapshot
      limit 1
    );
  end if;

  base_total := case
    when coalesce(draft_row.total_before_tip, 0) > 0 then draft_row.total_before_tip
    else greatest(0, coalesce(draft_row.total, 0) - coalesce(draft_row.tip, 0))
  end;

  update public.pos_live_drafts
  set tip = clean_tip,
      total = round(base_total + clean_tip, 2),
      last_tip_action_id = clean_request_id,
      version = version + 1
  where id = draft_row.id;

  return (
    select to_jsonb(snapshot)
    from public.get_pos_live_draft_by_token(p_token) snapshot
    limit 1
  );
end;
$$;

create or replace function public.upsert_pos_live_draft_customer_by_phone(
  p_token text,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  matched jsonb;
begin
  matched := public.find_pos_live_draft_customer_by_phone(p_phone, p_token);

  if matched is null then
    raise exception 'Customer was not found.';
  end if;

  return public.confirm_pos_live_draft_customer(
    p_token,
    (matched ->> 'id')::uuid,
    null
  );
end;
$$;

create or replace function public.create_pos_live_draft_customer_by_phone(
  p_token text,
  p_name text,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_row public.pos_live_drafts%rowtype;
  normalized_name text;
  normalized_phone text;
  saved_customer public.customers%rowtype;
  customer_payload jsonb;
begin
  normalized_name := nullif(btrim(coalesce(p_name, '')), '');
  normalized_phone := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');

  if normalized_name is null then
    raise exception 'Customer name is required.';
  end if;

  if normalized_phone is null then
    raise exception 'Phone is required.';
  end if;

  select *
  into draft_row
  from public.pos_live_drafts
  where token = btrim(coalesce(p_token, ''))
    and status = 'draft'
  limit 1;

  if draft_row.id is null then
    raise exception 'Live draft was not found.';
  end if;

  select *
  into saved_customer
  from public.customers
  where location_id = draft_row.salon_id
    and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = normalized_phone
    and status = 'active'
  order by created_at desc
  limit 1;

  if saved_customer.id is null then
    insert into public.customers (location_id, name, phone, status)
    values (draft_row.salon_id, normalized_name, normalized_phone, 'active')
    returning * into saved_customer;
  end if;

  customer_payload := jsonb_build_object(
    'id', saved_customer.id,
    'name', saved_customer.name,
    'phone', saved_customer.phone
  );

  update public.pos_live_drafts
  set customer = customer_payload,
      customer_version = customer_version + 1,
      version = version + 1
  where id = draft_row.id;

  return customer_payload;
end;
$$;

drop function if exists public.update_pos_portable_live_draft(
  uuid,
  text,
  text,
  text,
  jsonb,
  numeric,
  numeric,
  numeric
);

create or replace function public.update_pos_portable_live_draft(
  p_key_id uuid,
  p_session_signature text,
  p_token text,
  p_selected_staff_id text,
  p_staff_lines jsonb,
  p_subtotal numeric,
  p_tip numeric,
  p_total numeric,
  p_discount numeric default 0,
  p_tax numeric default 0,
  p_total_before_tip numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_salon_id uuid;
  draft_row public.pos_live_drafts%rowtype;
  next_total_before_tip numeric;
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

  next_total_before_tip := round(
    coalesce(p_total_before_tip, greatest(0, coalesce(p_total, 0) - coalesce(p_tip, 0))),
    2
  );

  update public.pos_live_drafts
  set completed_at = null,
      customer = case when status = 'draft' then customer else null end,
      discount = round(coalesce(p_discount, 0), 2),
      last_customer_action_id = case when status = 'draft' then last_customer_action_id else null end,
      last_tip_action_id = case when status = 'draft' then last_tip_action_id else null end,
      receipt_version = receipt_version + 1,
      reset_at = null,
      selected_staff_id = nullif(btrim(coalesce(p_selected_staff_id, '')), ''),
      staff_lines = coalesce(p_staff_lines, '[]'::jsonb),
      status = 'draft',
      subtotal = round(coalesce(p_subtotal, 0), 2),
      tax = round(coalesce(p_tax, 0), 2),
      tip = round(coalesce(p_tip, 0), 2),
      total = round(coalesce(p_total, 0), 2),
      total_before_tip = next_total_before_tip,
      version = version + 1
  where id = draft_row.id;

  return (
    select to_jsonb(snapshot)
    from public.get_pos_live_draft_by_token(p_token) snapshot
    limit 1
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
        and customers.status = 'active'
    ) then
      raise exception 'Selected customer must belong to the current salon.';
    end if;
  end if;

  update public.pos_live_drafts
  set completed_at = null,
      customer = case
        when p_customer is null or jsonb_typeof(p_customer) = 'null' then null
        else p_customer
      end,
      customer_version = customer_version + 1,
      reset_at = null,
      status = 'draft',
      version = version + 1
  where token = p_token
    and salon_id = target_salon_id
  returning * into draft_row;

  if draft_row.id is null then
    raise exception 'Live draft was not found.';
  end if;

  return (
    select to_jsonb(snapshot)
    from public.get_pos_live_draft_by_token(p_token) snapshot
    limit 1
  );
end;
$$;

create or replace function public.finalize_pos_portable_live_draft(
  p_key_id uuid,
  p_session_signature text,
  p_token text,
  p_reset_seconds integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_salon_id uuid;
  draft_row public.pos_live_drafts%rowtype;
  reset_seconds integer := greatest(1, least(coalesce(p_reset_seconds, 10), 60));
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null then
    return null;
  end if;

  update public.pos_live_drafts
  set completed_at = now(),
      reset_at = now() + make_interval(secs => reset_seconds),
      status = 'closed',
      version = version + 1
  where token = btrim(coalesce(p_token, ''))
    and salon_id = target_salon_id
  returning * into draft_row;

  if draft_row.id is null then
    return null;
  end if;

  return (
    select to_jsonb(snapshot)
    from public.get_pos_live_draft_by_token(p_token) snapshot
    limit 1
  );
end;
$$;

grant execute on function public.get_pos_live_draft_by_token(text) to anon, authenticated;
grant execute on function public.find_pos_live_draft_customer_by_phone(text, text) to anon, authenticated;
grant execute on function public.search_pos_live_draft_customers_by_phone(text, text) to anon, authenticated;
grant execute on function public.confirm_pos_live_draft_customer(text, uuid, text) to anon, authenticated;
grant execute on function public.confirm_pos_live_draft_tip(text, numeric, text) to anon, authenticated;
grant execute on function public.create_pos_live_draft_customer_by_phone(text, text, text) to anon, authenticated;
grant execute on function public.upsert_pos_live_draft_customer_by_phone(text, text) to anon, authenticated;
grant execute on function public.update_pos_portable_live_draft(uuid, text, text, text, jsonb, numeric, numeric, numeric, numeric, numeric, numeric) to anon, authenticated;
grant execute on function public.update_pos_portable_live_draft_customer(uuid, text, text, jsonb) to anon, authenticated;
grant execute on function public.finalize_pos_portable_live_draft(uuid, text, text, integer) to anon, authenticated;
