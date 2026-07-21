alter table public.pos_tickets
add column if not exists tip_type text not null default 'fixed_amount',
add column if not exists tip_value numeric(12,2) not null default 0;

alter table public.pos_tickets
drop constraint if exists pos_tickets_tip_type_check;

alter table public.pos_tickets
add constraint pos_tickets_tip_type_check check (
  tip_type in ('fixed_amount', 'percentage')
);

alter table public.pos_tickets
drop constraint if exists pos_tickets_tip_value_not_negative;

alter table public.pos_tickets
add constraint pos_tickets_tip_value_not_negative check (
  tip_value >= 0
);

alter table public.pos_tickets
drop constraint if exists pos_tickets_percentage_tip_range;

alter table public.pos_tickets
add constraint pos_tickets_percentage_tip_range check (
  tip_type <> 'percentage'
  or tip_value <= 100
);

create or replace function public.validate_pos_ticket_tip()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and (
      new.tip_type is distinct from old.tip_type
      or new.tip_value is distinct from old.tip_value
    )
    and old.status <> 'open'
  then
    raise exception 'Only Open tickets can update tip.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_pos_ticket_tip on public.pos_tickets;

create trigger validate_pos_ticket_tip
before insert or update on public.pos_tickets
for each row
execute function public.validate_pos_ticket_tip();

create or replace function public.validate_pos_payment_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  ticket_status text;
  ticket_discount_type text;
  ticket_discount_value numeric(12,2);
  ticket_tax_rate numeric(5,2);
  ticket_tip_type text;
  ticket_tip_value numeric(12,2);
  ticket_total numeric(12,2);
  discount_amount numeric(12,2);
  taxable_amount numeric(12,2);
  tax_amount numeric(12,2);
  after_tax_amount numeric(12,2);
  tip_amount numeric(12,2);
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

  select
    pos_tickets.status,
    pos_tickets.discount_type,
    pos_tickets.discount_value,
    pos_tickets.tax_rate,
    pos_tickets.tip_type,
    pos_tickets.tip_value
  into
    ticket_status,
    ticket_discount_type,
    ticket_discount_value,
    ticket_tax_rate,
    ticket_tip_type,
    ticket_tip_value
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

  if ticket_discount_type = 'percentage' then
    discount_amount := round(ticket_total * ticket_discount_value / 100, 2);
  else
    discount_amount := ticket_discount_value;
  end if;

  if discount_amount > ticket_total then
    discount_amount := ticket_total;
  end if;

  taxable_amount := ticket_total - discount_amount;
  tax_amount := round(taxable_amount * ticket_tax_rate / 100, 2);
  after_tax_amount := taxable_amount + tax_amount;

  if ticket_tip_type = 'percentage' then
    tip_amount := round(after_tax_amount * ticket_tip_value / 100, 2);
  else
    tip_amount := ticket_tip_value;
  end if;

  select coalesce(sum(pos_payments.amount), 0)
  into paid_total
  from public.pos_payments
  where pos_payments.ticket_id = new.ticket_id
    and pos_payments.organization_id = new.organization_id
    and pos_payments.salon_id = new.salon_id
    and (tg_op = 'INSERT' or pos_payments.id <> new.id);

  if new.amount > after_tax_amount + tip_amount - paid_total then
    raise exception 'Payment amount cannot exceed remaining balance.';
  end if;

  return new;
end;
$$;
