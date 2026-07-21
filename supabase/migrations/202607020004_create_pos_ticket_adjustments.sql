alter table public.pos_ticket_items
add column if not exists is_removed boolean not null default false,
add column if not exists removed_at timestamptz,
add column if not exists removed_by uuid references public.users(id) on delete restrict,
add column if not exists removal_reason text;

create index if not exists pos_ticket_items_ticket_active_idx
on public.pos_ticket_items(pos_ticket_id, created_at)
where is_removed = false;

drop policy if exists "Organization members can delete salon POS turn parts"
on public.pos_ticket_item_turn_parts;
create policy "Organization members can delete salon POS turn parts"
on public.pos_ticket_item_turn_parts
for delete
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

create table if not exists public.pos_ticket_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  ticket_id uuid not null references public.pos_tickets(id) on delete cascade,
  ticket_item_id uuid references public.pos_ticket_items(id) on delete set null,
  replacement_ticket_item_id uuid references public.pos_ticket_items(id) on delete set null,
  action text not null,
  reason text not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint pos_ticket_adjustments_action_check check (
    action in ('item_corrected', 'item_removed', 'item_replaced')
  ),
  constraint pos_ticket_adjustments_reason_not_blank check (
    length(btrim(reason)) > 0
  )
);

create index if not exists pos_ticket_adjustments_ticket_created_at_idx
on public.pos_ticket_adjustments(ticket_id, created_at desc);

create index if not exists pos_ticket_adjustments_organization_id_idx
on public.pos_ticket_adjustments(organization_id);

create index if not exists pos_ticket_adjustments_salon_id_idx
on public.pos_ticket_adjustments(salon_id);

create index if not exists pos_ticket_adjustments_created_by_idx
on public.pos_ticket_adjustments(created_by);

create or replace function public.validate_pos_ticket_adjustment_scope()
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
    raise exception 'POS ticket adjustment salon must belong to POS ticket adjustment organization.';
  end if;

  if not exists (
    select 1
    from public.pos_tickets
    where pos_tickets.id = new.ticket_id
      and pos_tickets.organization_id = new.organization_id
      and pos_tickets.salon_id = new.salon_id
  ) then
    raise exception 'POS ticket adjustment ticket must belong to POS ticket adjustment salon.';
  end if;

  if new.ticket_item_id is not null and not exists (
    select 1
    from public.pos_ticket_items
    where pos_ticket_items.id = new.ticket_item_id
      and pos_ticket_items.pos_ticket_id = new.ticket_id
      and pos_ticket_items.organization_id = new.organization_id
      and pos_ticket_items.salon_id = new.salon_id
  ) then
    raise exception 'POS ticket adjustment item must belong to POS ticket adjustment ticket.';
  end if;

  if new.replacement_ticket_item_id is not null and not exists (
    select 1
    from public.pos_ticket_items
    where pos_ticket_items.id = new.replacement_ticket_item_id
      and pos_ticket_items.pos_ticket_id = new.ticket_id
      and pos_ticket_items.organization_id = new.organization_id
      and pos_ticket_items.salon_id = new.salon_id
  ) then
    raise exception 'POS ticket adjustment replacement item must belong to POS ticket adjustment ticket.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_pos_ticket_adjustment_scope
on public.pos_ticket_adjustments;

create trigger validate_pos_ticket_adjustment_scope
before insert or update on public.pos_ticket_adjustments
for each row
execute function public.validate_pos_ticket_adjustment_scope();

alter table public.pos_ticket_adjustments enable row level security;

drop policy if exists "Organization members can view salon POS ticket adjustments"
on public.pos_ticket_adjustments;
create policy "Organization members can view salon POS ticket adjustments"
on public.pos_ticket_adjustments
for select
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_ticket_adjustments.salon_id
      and locations.organization_id = pos_ticket_adjustments.organization_id
  )
);

drop policy if exists "Organization members can create salon POS ticket adjustments"
on public.pos_ticket_adjustments;
create policy "Organization members can create salon POS ticket adjustments"
on public.pos_ticket_adjustments
for insert
to authenticated
with check (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_ticket_adjustments.salon_id
      and locations.organization_id = pos_ticket_adjustments.organization_id
  )
);
