-- Phase 5 additive repair: booking-to-ticket conversion must require the
-- existing canonical booking.manage permission plus tickets.manage.

create or replace function public.user_can_convert_booking_to_ticket(
  target_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct permissions.code) = 2
  from public.organization_memberships
  join public.role_permissions
    on role_permissions.role_id = organization_memberships.role_id
  join public.permissions
    on permissions.id = role_permissions.permission_id
  where organization_memberships.organization_id = target_organization_id
    and organization_memberships.user_id = public.current_public_user_id()
    and organization_memberships.status = 'active'
    and permissions.code = any(
      array['booking.manage', 'tickets.manage']::text[]
    )
$$;

revoke all on function public.user_can_convert_booking_to_ticket(uuid) from public, anon;
grant execute on function public.user_can_convert_booking_to_ticket(uuid) to authenticated;
