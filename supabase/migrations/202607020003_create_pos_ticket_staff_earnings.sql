create table if not exists public.pos_ticket_staff_earnings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  ticket_id uuid not null references public.pos_tickets(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete restrict,
  work_date date not null,
  service_total numeric(12,2) not null default 0,
  tip_amount numeric(12,2) not null default 0,
  big_turn_count integer not null default 0,
  small_turn_count integer not null default 0,
  first_big_turn_sequence integer,
  last_big_turn_sequence integer,
  first_small_turn_sequence integer,
  last_small_turn_sequence integer,
  commission_amount numeric(12,2) not null default 0,
  bonus_amount numeric(12,2) not null default 0,
  deduction_amount numeric(12,2) not null default 0,
  total_earning numeric(12,2) not null default 0,
  calculation_version integer not null default 1,
  locked_at timestamptz,
  payroll_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_ticket_staff_earnings_ticket_staff_unique unique (ticket_id, staff_id),
  constraint pos_ticket_staff_earnings_service_total_nonnegative check (service_total >= 0),
  constraint pos_ticket_staff_earnings_tip_amount_nonnegative check (tip_amount >= 0),
  constraint pos_ticket_staff_earnings_big_turn_count_nonnegative check (big_turn_count >= 0),
  constraint pos_ticket_staff_earnings_small_turn_count_nonnegative check (small_turn_count >= 0),
  constraint pos_ticket_staff_earnings_commission_amount_nonnegative check (commission_amount >= 0),
  constraint pos_ticket_staff_earnings_bonus_amount_nonnegative check (bonus_amount >= 0),
  constraint pos_ticket_staff_earnings_deduction_amount_nonnegative check (deduction_amount >= 0),
  constraint pos_ticket_staff_earnings_total_earning_nonnegative check (total_earning >= 0),
  constraint pos_ticket_staff_earnings_calculation_version_positive check (calculation_version > 0),
  constraint pos_ticket_staff_earnings_big_sequence_order check (
    first_big_turn_sequence is null
    or last_big_turn_sequence is null
    or first_big_turn_sequence <= last_big_turn_sequence
  ),
  constraint pos_ticket_staff_earnings_small_sequence_order check (
    first_small_turn_sequence is null
    or last_small_turn_sequence is null
    or first_small_turn_sequence <= last_small_turn_sequence
  )
);

create unique index if not exists pos_ticket_staff_earnings_ticket_staff_uidx
on public.pos_ticket_staff_earnings(ticket_id, staff_id);

create index if not exists pos_ticket_staff_earnings_salon_work_date_idx
on public.pos_ticket_staff_earnings(salon_id, work_date);

create index if not exists pos_ticket_staff_earnings_staff_work_date_idx
on public.pos_ticket_staff_earnings(staff_id, work_date);

create index if not exists pos_ticket_staff_earnings_organization_work_date_idx
on public.pos_ticket_staff_earnings(organization_id, work_date);

create index if not exists pos_ticket_staff_earnings_ticket_id_idx
on public.pos_ticket_staff_earnings(ticket_id);

create index if not exists pos_ticket_staff_earnings_payroll_batch_id_idx
on public.pos_ticket_staff_earnings(payroll_batch_id)
where payroll_batch_id is not null;

drop trigger if exists update_pos_ticket_staff_earnings_updated_at
on public.pos_ticket_staff_earnings;

create trigger update_pos_ticket_staff_earnings_updated_at
before update on public.pos_ticket_staff_earnings
for each row
execute function public.update_updated_at_column();

create or replace function public.validate_pos_ticket_staff_earning_scope()
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
    raise exception 'Staff earning salon must belong to staff earning organization.';
  end if;

  if not exists (
    select 1
    from public.pos_tickets
    where pos_tickets.id = new.ticket_id
      and pos_tickets.organization_id = new.organization_id
      and pos_tickets.salon_id = new.salon_id
  ) then
    raise exception 'Staff earning ticket must belong to staff earning salon.';
  end if;

  if not exists (
    select 1
    from public.staff
    where staff.id = new.staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'Staff earning staff must belong to staff earning salon.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_pos_ticket_staff_earning_scope
on public.pos_ticket_staff_earnings;

create trigger validate_pos_ticket_staff_earning_scope
before insert or update on public.pos_ticket_staff_earnings
for each row
execute function public.validate_pos_ticket_staff_earning_scope();

create or replace function public.prevent_locked_pos_ticket_staff_earning_update()
returns trigger
language plpgsql
as $$
begin
  if old.locked_at is not null then
    raise exception 'Locked staff earning rows cannot be updated.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_locked_pos_ticket_staff_earning_update
on public.pos_ticket_staff_earnings;

create trigger prevent_locked_pos_ticket_staff_earning_update
before update on public.pos_ticket_staff_earnings
for each row
execute function public.prevent_locked_pos_ticket_staff_earning_update();

create or replace function public.prevent_pos_ticket_staff_earning_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Staff earning rows cannot be hard deleted.';
end;
$$;

drop trigger if exists prevent_pos_ticket_staff_earning_delete
on public.pos_ticket_staff_earnings;

create trigger prevent_pos_ticket_staff_earning_delete
before delete on public.pos_ticket_staff_earnings
for each row
execute function public.prevent_pos_ticket_staff_earning_delete();

alter table public.pos_ticket_staff_earnings enable row level security;

drop policy if exists "Organization members can view salon POS staff earnings"
on public.pos_ticket_staff_earnings;
create policy "Organization members can view salon POS staff earnings"
on public.pos_ticket_staff_earnings
for select
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_ticket_staff_earnings.salon_id
      and locations.organization_id = pos_ticket_staff_earnings.organization_id
  )
);

drop policy if exists "Linked staff can view own POS staff earnings"
on public.pos_ticket_staff_earnings;
create policy "Linked staff can view own POS staff earnings"
on public.pos_ticket_staff_earnings
for select
to authenticated
using (
  exists (
    select 1
    from public.staff
    where staff.id = pos_ticket_staff_earnings.staff_id
      and staff.organization_id = pos_ticket_staff_earnings.organization_id
      and staff.salon_id = pos_ticket_staff_earnings.salon_id
      and staff.user_id = auth.uid()
  )
);

drop policy if exists "Organization members can create POS staff earnings"
on public.pos_ticket_staff_earnings;
create policy "Organization members can create POS staff earnings"
on public.pos_ticket_staff_earnings
for insert
to authenticated
with check (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_ticket_staff_earnings.salon_id
      and locations.organization_id = pos_ticket_staff_earnings.organization_id
  )
);

drop policy if exists "Organization members can update unlocked POS staff earnings"
on public.pos_ticket_staff_earnings;
create policy "Organization members can update unlocked POS staff earnings"
on public.pos_ticket_staff_earnings
for update
to authenticated
using (
  locked_at is null
  and public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_ticket_staff_earnings.salon_id
      and locations.organization_id = pos_ticket_staff_earnings.organization_id
  )
)
with check (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_ticket_staff_earnings.salon_id
      and locations.organization_id = pos_ticket_staff_earnings.organization_id
  )
);
