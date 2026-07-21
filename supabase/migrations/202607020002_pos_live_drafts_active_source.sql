alter table public.pos_live_drafts
add column if not exists staff_lines jsonb not null default '[]'::jsonb,
add column if not exists selected_staff_id text,
add column if not exists tip numeric not null default 0,
add column if not exists subtotal numeric not null default 0,
add column if not exists total numeric not null default 0;

update public.pos_live_drafts
set
  staff_lines = case
    when jsonb_typeof(receipt -> 'lines') = 'array' then receipt -> 'lines'
    else staff_lines
  end,
  selected_staff_id = coalesce(selected_staff_id, receipt ->> 'selectedStaffId'),
  subtotal = coalesce(nullif(receipt ->> 'subtotal', '')::numeric, subtotal, 0),
  total = coalesce(nullif(receipt ->> 'total', '')::numeric, total, 0)
where receipt is not null
  and receipt <> '{}'::jsonb;

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
  total numeric,
  status text,
  version integer,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    pos_live_drafts.id,
    pos_live_drafts.salon_id,
    pos_live_drafts.token,
    pos_live_drafts.customer,
    pos_live_drafts.staff_lines,
    pos_live_drafts.selected_staff_id,
    pos_live_drafts.tip,
    pos_live_drafts.subtotal,
    pos_live_drafts.total,
    pos_live_drafts.status,
    pos_live_drafts.version,
    pos_live_drafts.updated_at
  from public.pos_live_drafts
  where pos_live_drafts.token = p_token
  limit 1;
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
  customer_payload jsonb;
begin
  normalized_phone := nullif(regexp_replace(coalesce(p_phone, ''), '\s+', '', 'g'), '');

  if normalized_phone is null then
    raise exception 'Phone is required.';
  end if;

  select *
  into draft_row
  from public.pos_live_drafts
  where token = p_token
  limit 1;

  if draft_row.id is null then
    raise exception 'Live draft was not found.';
  end if;

  select *
  into matched_customer
  from public.customers
  where location_id = draft_row.salon_id
    and phone = normalized_phone
    and status = 'active'
  order by created_at desc
  limit 1;

  if matched_customer.id is null then
    return null;
  end if;

  customer_payload := jsonb_build_object(
    'id', matched_customer.id,
    'name', matched_customer.name,
    'phone', matched_customer.phone
  );

  update public.pos_live_drafts
  set
    customer = customer_payload,
    version = version + 1,
    updated_at = now()
  where id = draft_row.id;

  return customer_payload;
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
  normalized_phone := nullif(regexp_replace(coalesce(p_phone, ''), '\s+', '', 'g'), '');

  if normalized_name is null then
    raise exception 'Customer name is required.';
  end if;

  if normalized_phone is null then
    raise exception 'Phone is required.';
  end if;

  select *
  into draft_row
  from public.pos_live_drafts
  where token = p_token
  limit 1;

  if draft_row.id is null then
    raise exception 'Live draft was not found.';
  end if;

  select *
  into saved_customer
  from public.customers
  where location_id = draft_row.salon_id
    and phone = normalized_phone
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
  set
    customer = customer_payload,
    version = version + 1,
    updated_at = now()
  where id = draft_row.id;

  return customer_payload;
end;
$$;

grant execute on function public.get_pos_live_draft_by_token(text) to anon, authenticated;
grant execute on function public.find_pos_live_draft_customer_by_phone(text, text) to anon, authenticated;
grant execute on function public.create_pos_live_draft_customer_by_phone(text, text, text) to anon, authenticated;
