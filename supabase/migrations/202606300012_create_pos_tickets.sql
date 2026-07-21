create table if not exists public.pos_tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  ticket_number text not null,
  ticket_sequence bigint not null,
  customer_id uuid not null references public.customers(id) on delete restrict,
  opened_at timestamptz not null,
  closed_at timestamptz,
  status text not null default 'open',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_tickets_status_check check (
    status in ('open', 'closed', 'cancelled')
  ),
  constraint pos_tickets_closed_not_before_opened_check check (
    closed_at is null or closed_at >= opened_at
  ),
  constraint pos_tickets_ticket_sequence_positive_check check (
    ticket_sequence > 0
  ),
  constraint pos_tickets_salon_ticket_number_unique unique (
    salon_id,
    ticket_number
  ),
  constraint pos_tickets_salon_ticket_sequence_unique unique (
    salon_id,
    ticket_sequence
  )
);

create index if not exists pos_tickets_salon_opened_at_idx
on public.pos_tickets(salon_id, opened_at desc);

create index if not exists pos_tickets_organization_id_idx
on public.pos_tickets(organization_id);

create index if not exists pos_tickets_customer_id_idx
on public.pos_tickets(customer_id);

create index if not exists pos_tickets_salon_status_idx
on public.pos_tickets(salon_id, status);

drop trigger if exists update_pos_tickets_updated_at on public.pos_tickets;

create trigger update_pos_tickets_updated_at
before update on public.pos_tickets
for each row
execute function public.update_updated_at_column();

create or replace function public.assign_pos_ticket_number()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id then
      raise exception 'POS ticket organization cannot be changed.';
    end if;

    if new.salon_id <> old.salon_id then
      raise exception 'POS ticket salon cannot be changed.';
    end if;

    if new.ticket_number <> old.ticket_number then
      raise exception 'POS ticket number cannot be changed.';
    end if;

    if new.ticket_sequence <> old.ticket_sequence then
      raise exception 'POS ticket sequence cannot be changed.';
    end if;

    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.salon_id::text, 0));

  select coalesce(max(pos_tickets.ticket_sequence), 0) + 1
  into new.ticket_sequence
  from public.pos_tickets
  where pos_tickets.salon_id = new.salon_id;

  new.ticket_number := 'T-' || lpad(new.ticket_sequence::text, 6, '0');

  return new;
end;
$$;

drop trigger if exists assign_pos_ticket_number on public.pos_tickets;

create trigger assign_pos_ticket_number
before insert or update on public.pos_tickets
for each row
execute function public.assign_pos_ticket_number();

create or replace function public.validate_pos_ticket_scope()
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
    raise exception 'POS ticket salon must belong to POS ticket organization.';
  end if;

  if not exists (
    select 1
    from public.customers
    where customers.id = new.customer_id
      and customers.location_id = new.salon_id
  ) then
    raise exception 'POS ticket customer must belong to POS ticket salon.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_pos_ticket_scope on public.pos_tickets;

create trigger validate_pos_ticket_scope
before insert or update on public.pos_tickets
for each row
execute function public.validate_pos_ticket_scope();

create or replace function public.prevent_pos_ticket_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'POS tickets cannot be hard deleted. Set status to cancelled instead.';
end;
$$;

drop trigger if exists prevent_pos_ticket_delete on public.pos_tickets;

create trigger prevent_pos_ticket_delete
before delete on public.pos_tickets
for each row
execute function public.prevent_pos_ticket_delete();

insert into public.permissions (code, name, description, category, is_system)
values
  ('tickets.view', 'View POS tickets', 'View POS ticket records.', 'POS Tickets', true),
  ('tickets.manage', 'Manage POS tickets', 'Create and manage POS ticket records.', 'POS Tickets', true)
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  is_system = excluded.is_system,
  updated_at = now();

select public.assign_default_permissions_for_organization(organizations.id)
from public.organizations;

alter table public.pos_tickets enable row level security;

drop policy if exists "Organization members can view salon POS tickets" on public.pos_tickets;
create policy "Organization members can view salon POS tickets"
on public.pos_tickets
for select
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_tickets.salon_id
      and locations.organization_id = pos_tickets.organization_id
  )
);

drop policy if exists "Organization members can create salon POS tickets" on public.pos_tickets;
create policy "Organization members can create salon POS tickets"
on public.pos_tickets
for insert
to authenticated
with check (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_tickets.salon_id
      and locations.organization_id = pos_tickets.organization_id
  )
);

drop policy if exists "Organization members can update salon POS tickets" on public.pos_tickets;
create policy "Organization members can update salon POS tickets"
on public.pos_tickets
for update
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_tickets.salon_id
      and locations.organization_id = pos_tickets.organization_id
  )
)
with check (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_tickets.salon_id
      and locations.organization_id = pos_tickets.organization_id
  )
);
