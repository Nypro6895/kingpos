alter table public.pos_ticket_items
add column if not exists assigned_staff_id uuid references public.staff(id) on delete set null;

create index if not exists pos_ticket_items_assigned_staff_id_idx
on public.pos_ticket_items(assigned_staff_id);

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
