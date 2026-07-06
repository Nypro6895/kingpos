create table if not exists public.pos_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  pos_ticket_id uuid not null references public.pos_tickets(id) on delete cascade,
  amount numeric(12,2) not null,
  payment_method text not null default 'cash',
  paid_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_payments_amount_positive check (amount > 0),
  constraint pos_payments_payment_method_check check (
    payment_method in ('cash', 'card', 'other')
  )
);

create index if not exists pos_payments_ticket_paid_at_idx
on public.pos_payments(pos_ticket_id, paid_at desc);

create index if not exists pos_payments_organization_id_idx
on public.pos_payments(organization_id);

create index if not exists pos_payments_salon_id_idx
on public.pos_payments(salon_id);

drop trigger if exists update_pos_payments_updated_at on public.pos_payments;

create trigger update_pos_payments_updated_at
before update on public.pos_payments
for each row
execute function public.update_updated_at_column();

create or replace function public.prepare_pos_payment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id then
      raise exception 'POS payment organization cannot be changed.';
    end if;

    if new.salon_id <> old.salon_id then
      raise exception 'POS payment salon cannot be changed.';
    end if;

    if new.pos_ticket_id <> old.pos_ticket_id then
      raise exception 'POS payment ticket cannot be changed.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists prepare_pos_payment on public.pos_payments;

create trigger prepare_pos_payment
before insert or update on public.pos_payments
for each row
execute function public.prepare_pos_payment();

create or replace function public.validate_pos_payment_scope()
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
    raise exception 'POS payment salon must belong to POS payment organization.';
  end if;

  if not exists (
    select 1
    from public.pos_tickets
    where pos_tickets.id = new.pos_ticket_id
      and pos_tickets.organization_id = new.organization_id
      and pos_tickets.salon_id = new.salon_id
  ) then
    raise exception 'POS payment ticket must belong to POS payment salon.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_pos_payment_scope on public.pos_payments;

create trigger validate_pos_payment_scope
before insert or update on public.pos_payments
for each row
execute function public.validate_pos_payment_scope();

alter table public.pos_payments enable row level security;

drop policy if exists "Organization members can view salon POS payments" on public.pos_payments;
create policy "Organization members can view salon POS payments"
on public.pos_payments
for select
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_payments.salon_id
      and locations.organization_id = pos_payments.organization_id
  )
);

drop policy if exists "Organization members can create salon POS payments" on public.pos_payments;
create policy "Organization members can create salon POS payments"
on public.pos_payments
for insert
to authenticated
with check (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_payments.salon_id
      and locations.organization_id = pos_payments.organization_id
  )
);

drop policy if exists "Organization members can update salon POS payments" on public.pos_payments;
create policy "Organization members can update salon POS payments"
on public.pos_payments
for update
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_payments.salon_id
      and locations.organization_id = pos_payments.organization_id
  )
)
with check (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_payments.salon_id
      and locations.organization_id = pos_payments.organization_id
  )
);

drop policy if exists "Organization members can delete salon POS payments" on public.pos_payments;
create policy "Organization members can delete salon POS payments"
on public.pos_payments
for delete
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_payments.salon_id
      and locations.organization_id = pos_payments.organization_id
  )
);
