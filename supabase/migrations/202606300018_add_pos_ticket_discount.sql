alter table public.pos_tickets
add column if not exists discount_type text not null default 'fixed_amount',
add column if not exists discount_value numeric(12,2) not null default 0;

alter table public.pos_tickets
drop constraint if exists pos_tickets_discount_type_check;

alter table public.pos_tickets
add constraint pos_tickets_discount_type_check check (
  discount_type in ('fixed_amount', 'percentage')
);

alter table public.pos_tickets
drop constraint if exists pos_tickets_discount_value_not_negative;

alter table public.pos_tickets
add constraint pos_tickets_discount_value_not_negative check (
  discount_value >= 0
);

create or replace function public.validate_pos_ticket_discount()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  ticket_total numeric(12,2);
begin
  if tg_op = 'UPDATE'
    and (
      new.discount_type is distinct from old.discount_type
      or new.discount_value is distinct from old.discount_value
    )
    and old.status <> 'open'
  then
    raise exception 'Only Open tickets can update discounts.';
  end if;

  select coalesce(sum(pos_ticket_items.line_total), 0)
  into ticket_total
  from public.pos_ticket_items
  where pos_ticket_items.pos_ticket_id = new.id
    and pos_ticket_items.organization_id = new.organization_id
    and pos_ticket_items.salon_id = new.salon_id;

  if ticket_total = 0 and new.discount_value <> 0 then
    raise exception 'Discount must be zero when Subtotal is 0.';
  end if;

  if new.discount_type = 'fixed_amount' and new.discount_value > ticket_total then
    raise exception 'Fixed Amount discount must not exceed Subtotal.';
  end if;

  if new.discount_type = 'percentage' and new.discount_value > 100 then
    raise exception 'Percentage discount must be between 0 and 100.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_pos_ticket_discount on public.pos_tickets;

create trigger validate_pos_ticket_discount
before insert or update on public.pos_tickets
for each row
execute function public.validate_pos_ticket_discount();

create or replace function public.validate_pos_payment_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  ticket_status text;
  ticket_discount_type text;
  ticket_discount_value numeric(12,2);
  ticket_total numeric(12,2);
  discount_amount numeric(12,2);
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
    pos_tickets.discount_value
  into
    ticket_status,
    ticket_discount_type,
    ticket_discount_value
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

  select coalesce(sum(pos_payments.amount), 0)
  into paid_total
  from public.pos_payments
  where pos_payments.ticket_id = new.ticket_id
    and pos_payments.organization_id = new.organization_id
    and pos_payments.salon_id = new.salon_id
    and (tg_op = 'INSERT' or pos_payments.id <> new.id);

  if new.amount > ticket_total - discount_amount - paid_total then
    raise exception 'Payment amount cannot exceed remaining balance.';
  end if;

  return new;
end;
$$;
