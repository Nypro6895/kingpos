drop trigger if exists update_pos_payments_updated_at on public.pos_payments;

alter table public.pos_payments
rename column pos_ticket_id to ticket_id;

alter table public.pos_payments
rename column notes to note;

alter table public.pos_payments
add column if not exists created_by uuid references public.users(id) on delete set null;

alter table public.pos_payments
drop column if exists paid_at;

alter table public.pos_payments
drop column if exists updated_at;

alter table public.pos_payments
drop constraint if exists pos_payments_payment_method_check;

alter table public.pos_payments
add constraint pos_payments_payment_method_check check (
  payment_method in ('cash', 'credit_card', 'debit_card', 'gift_card', 'other')
);

drop index if exists public.pos_payments_ticket_paid_at_idx;

create index if not exists pos_payments_ticket_created_at_idx
on public.pos_payments(ticket_id, created_at desc);

create index if not exists pos_payments_created_by_idx
on public.pos_payments(created_by);

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

    if new.ticket_id <> old.ticket_id then
      raise exception 'POS payment ticket cannot be changed.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.validate_pos_payment_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  ticket_status text;
  ticket_total numeric(12,2);
  paid_total numeric(12,2);
begin
  if not exists (
    select 1
    from public.locations
    where locations.id = new.salon_id
      and locations.organization_id = new.organization_id
  ) then
    raise exception 'POS payment salon must belong to POS payment organization.';
  end if;

  select pos_tickets.status
  into ticket_status
  from public.pos_tickets
  where pos_tickets.id = new.ticket_id
    and pos_tickets.organization_id = new.organization_id
    and pos_tickets.salon_id = new.salon_id;

  if ticket_status is null then
    raise exception 'POS payment ticket must belong to POS payment salon.';
  end if;

  if ticket_status <> 'open' then
    raise exception 'Payments can only be created for Open tickets.';
  end if;

  select coalesce(sum(pos_ticket_items.line_total), 0)
  into ticket_total
  from public.pos_ticket_items
  where pos_ticket_items.pos_ticket_id = new.ticket_id
    and pos_ticket_items.organization_id = new.organization_id
    and pos_ticket_items.salon_id = new.salon_id;

  select coalesce(sum(pos_payments.amount), 0)
  into paid_total
  from public.pos_payments
  where pos_payments.ticket_id = new.ticket_id
    and pos_payments.organization_id = new.organization_id
    and pos_payments.salon_id = new.salon_id
    and (tg_op = 'INSERT' or pos_payments.id <> new.id);

  if new.amount > ticket_total - paid_total then
    raise exception 'Payment amount cannot exceed remaining balance.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_pos_payment_delete on public.pos_payments;

create or replace function public.validate_pos_payment_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.pos_tickets
    where pos_tickets.id = old.ticket_id
      and pos_tickets.organization_id = old.organization_id
      and pos_tickets.salon_id = old.salon_id
      and pos_tickets.status = 'open'
  ) then
    raise exception 'Payments can only be deleted while the ticket is Open.';
  end if;

  return old;
end;
$$;

create trigger validate_pos_payment_delete
before delete on public.pos_payments
for each row
execute function public.validate_pos_payment_delete();
