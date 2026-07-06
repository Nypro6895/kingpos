create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  staff_id uuid references public.staff(id) on delete set null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  notes text,
  status text not null default 'scheduled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_status_check check (
    status in ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show')
  ),
  constraint bookings_end_after_start_check check (end_at > start_at)
);

create index if not exists bookings_salon_start_at_idx
on public.bookings(salon_id, start_at);

create index if not exists bookings_organization_id_idx
on public.bookings(organization_id);

create index if not exists bookings_customer_id_idx
on public.bookings(customer_id);

create index if not exists bookings_staff_id_idx
on public.bookings(staff_id);

create index if not exists bookings_salon_status_idx
on public.bookings(salon_id, status);

drop trigger if exists update_bookings_updated_at on public.bookings;

create trigger update_bookings_updated_at
before update on public.bookings
for each row
execute function public.update_updated_at_column();

create or replace function public.validate_booking_scope()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.locations
    where locations.id = new.salon_id
      and locations.organization_id = new.organization_id
  ) then
    raise exception 'Booking salon must belong to booking organization.';
  end if;

  if not exists (
    select 1
    from public.customers
    where customers.id = new.customer_id
      and customers.location_id = new.salon_id
  ) then
    raise exception 'Booking customer must belong to booking salon.';
  end if;

  if new.staff_id is not null and not exists (
    select 1
    from public.staff
    where staff.id = new.staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'Booking staff must belong to booking salon.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_booking_scope on public.bookings;

create trigger validate_booking_scope
before insert or update on public.bookings
for each row
execute function public.validate_booking_scope();

create or replace function public.prevent_booking_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Bookings cannot be hard deleted. Set status to cancelled instead.';
end;
$$;

drop trigger if exists prevent_booking_delete on public.bookings;

create trigger prevent_booking_delete
before delete on public.bookings
for each row
execute function public.prevent_booking_delete();

insert into public.permissions (code, name, description, category, is_system)
values
  ('booking.view', 'View bookings', 'View booking records.', 'Booking', true),
  ('booking.manage', 'Manage bookings', 'Create and manage booking records.', 'Booking', true)
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  is_system = excluded.is_system,
  updated_at = now();

select public.assign_default_permissions_for_organization(organizations.id)
from public.organizations;

alter table public.bookings enable row level security;

drop policy if exists "Organization members can view salon bookings" on public.bookings;
create policy "Organization members can view salon bookings"
on public.bookings
for select
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = bookings.salon_id
      and locations.organization_id = bookings.organization_id
  )
);

drop policy if exists "Organization members can create salon bookings" on public.bookings;
create policy "Organization members can create salon bookings"
on public.bookings
for insert
to authenticated
with check (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = bookings.salon_id
      and locations.organization_id = bookings.organization_id
  )
);

drop policy if exists "Organization members can update salon bookings" on public.bookings;
create policy "Organization members can update salon bookings"
on public.bookings
for update
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = bookings.salon_id
      and locations.organization_id = bookings.organization_id
  )
)
with check (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = bookings.salon_id
      and locations.organization_id = bookings.organization_id
  )
);
