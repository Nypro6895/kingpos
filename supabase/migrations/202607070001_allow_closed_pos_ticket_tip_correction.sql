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
    and coalesce(
      current_setting('kingpos.allow_closed_ticket_tip_correction', true),
      ''
    ) <> 'on'
  then
    raise exception 'Only Open tickets can update tip.';
  end if;

  return new;
end;
$$;

create or replace function public.update_closed_pos_ticket_tip_for_correction(
  p_ticket_id uuid,
  p_tip_type text,
  p_tip_value numeric
)
returns public.pos_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  target_ticket public.pos_tickets%rowtype;
  updated_ticket public.pos_tickets%rowtype;
begin
  if p_ticket_id is null then
    raise exception 'Ticket id is required.';
  end if;

  if p_tip_type not in ('fixed_amount', 'percentage') then
    raise exception 'Tip Type is required.';
  end if;

  if p_tip_value is null or p_tip_value < 0 then
    raise exception 'Tip cannot be negative.';
  end if;

  if p_tip_type = 'percentage' and p_tip_value > 100 then
    raise exception 'Percentage Tip must be between 0 and 100.';
  end if;

  select *
  into target_ticket
  from public.pos_tickets
  where id = p_ticket_id;

  if target_ticket.id is null then
    raise exception 'POS Ticket is required.';
  end if;

  if target_ticket.status <> 'closed' then
    raise exception 'Only closed tickets can be corrected with this action.';
  end if;

  if not exists (
    select 1
    from public.organization_memberships
    join public.role_permissions
      on role_permissions.role_id = organization_memberships.role_id
    join public.permissions
      on permissions.id = role_permissions.permission_id
    where organization_memberships.organization_id = target_ticket.organization_id
      and organization_memberships.user_id = public.current_public_user_id()
      and organization_memberships.status = 'active'
      and permissions.code in ('tickets.manage', 'tickets.void')
  ) then
    raise exception 'You do not have permission to correct closed POS tickets.';
  end if;

  perform set_config('kingpos.allow_closed_ticket_tip_correction', 'on', true);

  update public.pos_tickets
  set tip_type = p_tip_type,
      tip_value = round(p_tip_value, 2)
  where id = p_ticket_id
  returning * into updated_ticket;

  return updated_ticket;
end;
$$;

revoke all on function public.update_closed_pos_ticket_tip_for_correction(uuid, text, numeric)
from public;
revoke all on function public.update_closed_pos_ticket_tip_for_correction(uuid, text, numeric)
from anon;
grant execute on function public.update_closed_pos_ticket_tip_for_correction(uuid, text, numeric)
to authenticated;
