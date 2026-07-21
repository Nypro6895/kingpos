alter table public.pos_ticket_items
alter column service_id drop not null;

create or replace function public.prepare_pos_ticket_item()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  service_price numeric(10,2);
begin
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id then
      raise exception 'POS ticket item organization cannot be changed.';
    end if;

    if new.salon_id <> old.salon_id then
      raise exception 'POS ticket item salon cannot be changed.';
    end if;

    if new.pos_ticket_id <> old.pos_ticket_id then
      raise exception 'POS ticket item ticket cannot be changed.';
    end if;

    if new.service_id is distinct from old.service_id then
      raise exception 'POS ticket item service cannot be changed.';
    end if;
  end if;

  if tg_op = 'INSERT' and new.unit_price is null and new.service_id is not null then
    select services.base_price
    into service_price
    from public.services
    where services.id = new.service_id
      and services.organization_id = new.organization_id
      and services.salon_id = new.salon_id;

    if service_price is null then
      raise exception 'POS ticket item service must belong to POS ticket item salon.';
    end if;

    new.unit_price := service_price;
  end if;

  if new.unit_price is null then
    raise exception 'POS ticket item unit price is required.';
  end if;

  return new;
end;
$$;

create or replace function public.validate_pos_ticket_item_scope()
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
    raise exception 'POS ticket item salon must belong to POS ticket item organization.';
  end if;

  if not exists (
    select 1
    from public.pos_tickets
    where pos_tickets.id = new.pos_ticket_id
      and pos_tickets.organization_id = new.organization_id
      and pos_tickets.salon_id = new.salon_id
  ) then
    raise exception 'POS ticket item ticket must belong to POS ticket item salon.';
  end if;

  if new.service_id is not null and not exists (
    select 1
    from public.services
    where services.id = new.service_id
      and services.organization_id = new.organization_id
      and services.salon_id = new.salon_id
  ) then
    raise exception 'POS ticket item service must belong to POS ticket item salon.';
  end if;

  if new.assigned_staff_id is not null and not exists (
    select 1
    from public.staff
    where staff.id = new.assigned_staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'Assigned staff must belong to POS ticket item salon.';
  end if;

  return new;
end;
$$;

create table if not exists public.pos_ticket_item_turn_parts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  ticket_id uuid not null references public.pos_tickets(id) on delete cascade,
  ticket_item_id uuid not null references public.pos_ticket_items(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete restrict,
  amount numeric(12,2) not null,
  turn_type text not null,
  turn_index integer not null,
  work_date date not null,
  created_at timestamptz not null default now(),
  constraint pos_ticket_item_turn_parts_amount_positive check (amount > 0),
  constraint pos_ticket_item_turn_parts_turn_type_check check (
    turn_type in ('large', 'small')
  ),
  constraint pos_ticket_item_turn_parts_turn_index_positive check (turn_index > 0),
  constraint pos_ticket_item_turn_parts_item_index_unique unique (
    ticket_item_id,
    turn_index
  )
);

create index if not exists pos_ticket_item_turn_parts_salon_work_date_idx
on public.pos_ticket_item_turn_parts(salon_id, work_date, staff_id);

create index if not exists pos_ticket_item_turn_parts_ticket_id_idx
on public.pos_ticket_item_turn_parts(ticket_id);

create index if not exists pos_ticket_item_turn_parts_staff_id_idx
on public.pos_ticket_item_turn_parts(staff_id);

create or replace function public.validate_pos_ticket_item_turn_part_scope()
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
    raise exception 'Turn part salon must belong to turn part organization.';
  end if;

  if not exists (
    select 1
    from public.pos_tickets
    where pos_tickets.id = new.ticket_id
      and pos_tickets.organization_id = new.organization_id
      and pos_tickets.salon_id = new.salon_id
  ) then
    raise exception 'Turn part ticket must belong to turn part salon.';
  end if;

  if not exists (
    select 1
    from public.pos_ticket_items
    where pos_ticket_items.id = new.ticket_item_id
      and pos_ticket_items.pos_ticket_id = new.ticket_id
      and pos_ticket_items.organization_id = new.organization_id
      and pos_ticket_items.salon_id = new.salon_id
      and pos_ticket_items.assigned_staff_id = new.staff_id
  ) then
    raise exception 'Turn part item must belong to the assigned staff and ticket.';
  end if;

  if not exists (
    select 1
    from public.staff
    where staff.id = new.staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'Turn part staff must belong to turn part salon.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_pos_ticket_item_turn_part_scope
on public.pos_ticket_item_turn_parts;

create trigger validate_pos_ticket_item_turn_part_scope
before insert or update on public.pos_ticket_item_turn_parts
for each row
execute function public.validate_pos_ticket_item_turn_part_scope();

alter table public.pos_ticket_item_turn_parts enable row level security;

drop policy if exists "Organization members can view salon POS turn parts"
on public.pos_ticket_item_turn_parts;
create policy "Organization members can view salon POS turn parts"
on public.pos_ticket_item_turn_parts
for select
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_ticket_item_turn_parts.salon_id
      and locations.organization_id = pos_ticket_item_turn_parts.organization_id
  )
);

drop policy if exists "Organization members can create salon POS turn parts"
on public.pos_ticket_item_turn_parts;
create policy "Organization members can create salon POS turn parts"
on public.pos_ticket_item_turn_parts
for insert
to authenticated
with check (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_ticket_item_turn_parts.salon_id
      and locations.organization_id = pos_ticket_item_turn_parts.organization_id
  )
);
