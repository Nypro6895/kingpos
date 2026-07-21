create table if not exists public.pos_ticket_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  pos_ticket_id uuid not null references public.pos_tickets(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete restrict,
  quantity numeric(10,2) not null default 1,
  unit_price numeric(10,2),
  line_total numeric(12,2) generated always as (quantity * unit_price) stored,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_ticket_items_quantity_positive check (quantity > 0),
  constraint pos_ticket_items_unit_price_not_negative check (unit_price >= 0)
);

create index if not exists pos_ticket_items_ticket_created_at_idx
on public.pos_ticket_items(pos_ticket_id, created_at);

create index if not exists pos_ticket_items_organization_id_idx
on public.pos_ticket_items(organization_id);

create index if not exists pos_ticket_items_salon_id_idx
on public.pos_ticket_items(salon_id);

create index if not exists pos_ticket_items_service_id_idx
on public.pos_ticket_items(service_id);

drop trigger if exists update_pos_ticket_items_updated_at on public.pos_ticket_items;

create trigger update_pos_ticket_items_updated_at
before update on public.pos_ticket_items
for each row
execute function public.update_updated_at_column();

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

    if new.service_id <> old.service_id then
      raise exception 'POS ticket item service cannot be changed.';
    end if;
  end if;

  if tg_op = 'INSERT' and new.unit_price is null then
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

  return new;
end;
$$;

drop trigger if exists prepare_pos_ticket_item on public.pos_ticket_items;

create trigger prepare_pos_ticket_item
before insert or update on public.pos_ticket_items
for each row
execute function public.prepare_pos_ticket_item();

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

  if not exists (
    select 1
    from public.services
    where services.id = new.service_id
      and services.organization_id = new.organization_id
      and services.salon_id = new.salon_id
  ) then
    raise exception 'POS ticket item service must belong to POS ticket item salon.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_pos_ticket_item_scope on public.pos_ticket_items;

create trigger validate_pos_ticket_item_scope
before insert or update on public.pos_ticket_items
for each row
execute function public.validate_pos_ticket_item_scope();

alter table public.pos_ticket_items enable row level security;

drop policy if exists "Organization members can view salon POS ticket items" on public.pos_ticket_items;
create policy "Organization members can view salon POS ticket items"
on public.pos_ticket_items
for select
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_ticket_items.salon_id
      and locations.organization_id = pos_ticket_items.organization_id
  )
);

drop policy if exists "Organization members can create salon POS ticket items" on public.pos_ticket_items;
create policy "Organization members can create salon POS ticket items"
on public.pos_ticket_items
for insert
to authenticated
with check (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_ticket_items.salon_id
      and locations.organization_id = pos_ticket_items.organization_id
  )
);

drop policy if exists "Organization members can update salon POS ticket items" on public.pos_ticket_items;
create policy "Organization members can update salon POS ticket items"
on public.pos_ticket_items
for update
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_ticket_items.salon_id
      and locations.organization_id = pos_ticket_items.organization_id
  )
)
with check (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_ticket_items.salon_id
      and locations.organization_id = pos_ticket_items.organization_id
  )
);

drop policy if exists "Organization members can delete salon POS ticket items" on public.pos_ticket_items;
create policy "Organization members can delete salon POS ticket items"
on public.pos_ticket_items
for delete
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_ticket_items.salon_id
      and locations.organization_id = pos_ticket_items.organization_id
  )
);
