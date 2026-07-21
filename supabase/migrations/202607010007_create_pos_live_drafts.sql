create table if not exists public.pos_live_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  token text not null unique,
  customer jsonb,
  receipt jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  version integer not null default 0,
  customer_version integer not null default 0,
  receipt_version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_live_drafts_status_check check (status in ('draft', 'closed'))
);

create index if not exists pos_live_drafts_salon_updated_at_idx
on public.pos_live_drafts(salon_id, updated_at desc);

create index if not exists pos_live_drafts_token_idx
on public.pos_live_drafts(token);

drop trigger if exists update_pos_live_drafts_updated_at on public.pos_live_drafts;

create trigger update_pos_live_drafts_updated_at
before update on public.pos_live_drafts
for each row
execute function public.update_updated_at_column();

alter table public.pos_live_drafts enable row level security;

drop policy if exists "Organization members can view salon live drafts" on public.pos_live_drafts;
create policy "Organization members can view salon live drafts"
on public.pos_live_drafts
for select
to authenticated
using (public.user_belongs_to_organization(organization_id));

drop policy if exists "Organization members can create salon live drafts" on public.pos_live_drafts;
create policy "Organization members can create salon live drafts"
on public.pos_live_drafts
for insert
to authenticated
with check (public.user_belongs_to_organization(organization_id));

drop policy if exists "Organization members can update salon live drafts" on public.pos_live_drafts;
create policy "Organization members can update salon live drafts"
on public.pos_live_drafts
for update
to authenticated
using (public.user_belongs_to_organization(organization_id))
with check (public.user_belongs_to_organization(organization_id));

create or replace function public.get_pos_live_draft_by_token(p_token text)
returns table (
  id uuid,
  salon_id uuid,
  token text,
  customer jsonb,
  receipt jsonb,
  status text,
  version integer,
  customer_version integer,
  receipt_version integer,
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
    pos_live_drafts.receipt,
    pos_live_drafts.status,
    pos_live_drafts.version,
    pos_live_drafts.customer_version,
    pos_live_drafts.receipt_version,
    pos_live_drafts.updated_at
  from public.pos_live_drafts
  where pos_live_drafts.token = p_token
  limit 1;
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
    insert into public.customers (location_id, name, phone, status)
    values (draft_row.salon_id, 'Guest ' || normalized_phone, normalized_phone, 'active')
    returning * into matched_customer;
  end if;

  customer_payload := jsonb_build_object(
    'id', matched_customer.id,
    'name', matched_customer.name,
    'phone', matched_customer.phone
  );

  update public.pos_live_drafts
  set
    customer = customer_payload,
    customer_version = customer_version + 1,
    version = version + 1,
    updated_at = now()
  where id = draft_row.id;

  return customer_payload;
end;
$$;

grant execute on function public.get_pos_live_draft_by_token(text) to anon, authenticated;
grant execute on function public.upsert_pos_live_draft_customer_by_phone(text, text) to anon, authenticated;

create or replace function public.find_pos_live_draft_customer_by_phone(
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
  matched_customer public.customers%rowtype;
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

  return jsonb_build_object(
    'id', matched_customer.id,
    'name', matched_customer.name,
    'phone', matched_customer.phone
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
    customer_version = customer_version + 1,
    version = version + 1,
    updated_at = now()
  where id = draft_row.id;

  return customer_payload;
end;
$$;

grant execute on function public.find_pos_live_draft_customer_by_phone(text, text) to anon, authenticated;
grant execute on function public.create_pos_live_draft_customer_by_phone(text, text, text) to anon, authenticated;
