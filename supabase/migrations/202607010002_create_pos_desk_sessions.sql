create table if not exists public.pos_desk_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  customer_display_token text unique not null,
  status text not null default 'active',
  customer_lookup_value text,
  customer_name_snapshot text,
  note text,
  tip_amount numeric(12,2) not null default 0,
  customer_confirmed_at timestamptz,
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  submitted_ticket_id uuid references public.pos_tickets(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_desk_sessions_status_check check (
    status in ('active', 'submitted', 'cancelled', 'expired')
  ),
  constraint pos_desk_sessions_tip_amount_not_negative check (tip_amount >= 0)
);

create table if not exists public.pos_desk_session_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  session_id uuid not null references public.pos_desk_sessions(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete restrict,
  service_id uuid references public.services(id) on delete set null,
  service_label text not null,
  amount numeric(12,2) not null,
  amount_input text not null,
  amount_parts jsonb not null,
  turn_large_count integer not null default 0,
  turn_small_count integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_desk_session_lines_amount_positive check (amount > 0),
  constraint pos_desk_session_lines_service_label_not_blank check (
    length(btrim(service_label)) > 0
  ),
  constraint pos_desk_session_lines_turn_counts_not_negative check (
    turn_large_count >= 0 and turn_small_count >= 0
  )
);

create index if not exists pos_desk_sessions_salon_status_idx
on public.pos_desk_sessions(salon_id, status);

create index if not exists pos_desk_sessions_customer_display_token_idx
on public.pos_desk_sessions(customer_display_token);

create index if not exists pos_desk_sessions_last_activity_at_idx
on public.pos_desk_sessions(last_activity_at);

create index if not exists pos_desk_sessions_expires_at_idx
on public.pos_desk_sessions(expires_at);

create index if not exists pos_desk_session_lines_session_id_idx
on public.pos_desk_session_lines(session_id, sort_order, created_at);

create index if not exists pos_desk_session_lines_staff_id_idx
on public.pos_desk_session_lines(staff_id);

drop trigger if exists update_pos_desk_sessions_updated_at on public.pos_desk_sessions;
create trigger update_pos_desk_sessions_updated_at
before update on public.pos_desk_sessions
for each row
execute function public.update_updated_at_column();

drop trigger if exists update_pos_desk_session_lines_updated_at on public.pos_desk_session_lines;
create trigger update_pos_desk_session_lines_updated_at
before update on public.pos_desk_session_lines
for each row
execute function public.update_updated_at_column();

create or replace function public.touch_pos_desk_session_from_line()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.pos_desk_sessions
  set last_activity_at = now(),
      expires_at = now() + interval '5 minutes'
  where id = case when tg_op = 'DELETE' then old.session_id else new.session_id end
    and status = 'active';

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists touch_pos_desk_session_from_line_insert on public.pos_desk_session_lines;
create trigger touch_pos_desk_session_from_line_insert
after insert or update or delete on public.pos_desk_session_lines
for each row
execute function public.touch_pos_desk_session_from_line();

create or replace function public.validate_pos_desk_session_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.locations
    where locations.id = new.salon_id
      and locations.organization_id = new.organization_id
  ) then
    raise exception 'POS desk session salon must belong to organization.';
  end if;

  if new.customer_id is not null and not exists (
    select 1
    from public.customers
    where customers.id = new.customer_id
      and customers.location_id = new.salon_id
  ) then
    raise exception 'POS desk session customer must belong to salon.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_pos_desk_session_scope on public.pos_desk_sessions;
create trigger validate_pos_desk_session_scope
before insert or update on public.pos_desk_sessions
for each row
execute function public.validate_pos_desk_session_scope();

create or replace function public.validate_pos_desk_session_line_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.pos_desk_sessions
    where pos_desk_sessions.id = new.session_id
      and pos_desk_sessions.organization_id = new.organization_id
      and pos_desk_sessions.salon_id = new.salon_id
      and pos_desk_sessions.status = 'active'
  ) then
    raise exception 'POS desk session line must belong to an active session.';
  end if;

  if not exists (
    select 1
    from public.staff
    where staff.id = new.staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'POS desk session line staff must belong to salon.';
  end if;

  if new.service_id is not null and not exists (
    select 1
    from public.services
    where services.id = new.service_id
      and services.organization_id = new.organization_id
      and services.salon_id = new.salon_id
  ) then
    raise exception 'POS desk session line service must belong to salon.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_pos_desk_session_line_scope on public.pos_desk_session_lines;
create trigger validate_pos_desk_session_line_scope
before insert or update on public.pos_desk_session_lines
for each row
execute function public.validate_pos_desk_session_line_scope();

alter table public.pos_desk_sessions enable row level security;
alter table public.pos_desk_session_lines enable row level security;

drop policy if exists "Organization members can view POS desk sessions" on public.pos_desk_sessions;
create policy "Organization members can view POS desk sessions"
on public.pos_desk_sessions
for select
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_desk_sessions.salon_id
      and locations.organization_id = pos_desk_sessions.organization_id
  )
);

drop policy if exists "Organization members can create POS desk sessions" on public.pos_desk_sessions;
create policy "Organization members can create POS desk sessions"
on public.pos_desk_sessions
for insert
to authenticated
with check (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_desk_sessions.salon_id
      and locations.organization_id = pos_desk_sessions.organization_id
  )
);

drop policy if exists "Organization members can update POS desk sessions" on public.pos_desk_sessions;
create policy "Organization members can update POS desk sessions"
on public.pos_desk_sessions
for update
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_desk_sessions.salon_id
      and locations.organization_id = pos_desk_sessions.organization_id
  )
)
with check (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_desk_sessions.salon_id
      and locations.organization_id = pos_desk_sessions.organization_id
  )
);

drop policy if exists "Organization members can view POS desk session lines" on public.pos_desk_session_lines;
create policy "Organization members can view POS desk session lines"
on public.pos_desk_session_lines
for select
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_desk_session_lines.salon_id
      and locations.organization_id = pos_desk_session_lines.organization_id
  )
);

drop policy if exists "Organization members can create POS desk session lines" on public.pos_desk_session_lines;
create policy "Organization members can create POS desk session lines"
on public.pos_desk_session_lines
for insert
to authenticated
with check (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_desk_session_lines.salon_id
      and locations.organization_id = pos_desk_session_lines.organization_id
  )
);

drop policy if exists "Organization members can update POS desk session lines" on public.pos_desk_session_lines;
create policy "Organization members can update POS desk session lines"
on public.pos_desk_session_lines
for update
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_desk_session_lines.salon_id
      and locations.organization_id = pos_desk_session_lines.organization_id
  )
)
with check (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_desk_session_lines.salon_id
      and locations.organization_id = pos_desk_session_lines.organization_id
  )
);

drop policy if exists "Organization members can delete POS desk session lines" on public.pos_desk_session_lines;
create policy "Organization members can delete POS desk session lines"
on public.pos_desk_session_lines
for delete
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_desk_session_lines.salon_id
      and locations.organization_id = pos_desk_session_lines.organization_id
  )
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

  if session_row.status = 'active' and session_row.expires_at <= now() then
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
  updated_id uuid;
begin
  update public.pos_desk_sessions
  set customer_lookup_value = nullif(btrim(p_customer_lookup), ''),
      customer_name_snapshot = coalesce(nullif(btrim(p_customer_lookup), ''), customer_name_snapshot),
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

grant execute on function public.get_pos_desk_session_by_token(text) to anon, authenticated;
grant execute on function public.update_pos_desk_session_tip_by_token(text, numeric, boolean) to anon, authenticated;
grant execute on function public.update_pos_desk_session_customer_by_token(text, text) to anon, authenticated;
