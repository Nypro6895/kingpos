-- Staff may control their own online availability and booking notices.
-- Salon gates, service assignments and profile publication remain unchanged.
begin;
alter table public.staff add column if not exists booking_notifications_enabled boolean not null default true;

create or replace function public.own_staff_booking_preferences(
  p_salon_id uuid, p_online boolean default null, p_notifications boolean default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  actor uuid := public.current_public_user_id();
  own_staff uuid := public.current_user_staff_id_for_salon(p_salon_id);
  result jsonb;
begin
  if actor is null or own_staff is null then
    raise exception 'Only active staff can manage their own booking preferences.' using errcode = '42501';
  end if;
  if p_online is not null or p_notifications is not null then
    update public.staff set
      online_booking_enabled = coalesce(p_online, online_booking_enabled),
      booking_notifications_enabled = coalesce(p_notifications, booking_notifications_enabled),
      updated_at = now()
    where id = own_staff and salon_id = p_salon_id
      and coalesce(account_user_id, user_id) = actor and is_active;
    if not found then raise exception 'Staff access denied.' using errcode = '42501'; end if;
  end if;
  select jsonb_build_object('ok', true, 'online', online_booking_enabled, 'notifications', booking_notifications_enabled)
    into result from public.staff where id = own_staff and salon_id = p_salon_id
    and coalesce(account_user_id, user_id) = actor and is_active;
  if result is null then raise exception 'Staff access denied.' using errcode = '42501'; end if;
  return result;
end;
$$;
revoke all on function public.own_staff_booking_preferences(uuid, boolean, boolean) from public, anon;
grant execute on function public.own_staff_booking_preferences(uuid, boolean, boolean) to authenticated;

-- Enforce mute at delivery so every booking notification producer respects it.
-- Existing notices and customer/owner notifications are preserved.
create or replace function public.filter_staff_booking_notification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.recipient_kind = 'staff' and new.booking_id is not null and exists (
    select 1 from public.staff s where s.salon_id = new.salon_id
      and coalesce(s.account_user_id, s.user_id) = new.recipient_user_id
      and s.is_active and not s.booking_notifications_enabled
  ) then return null; end if;
  return new;
end;
$$;
revoke all on function public.filter_staff_booking_notification() from public, anon, authenticated;
drop trigger if exists respect_staff_booking_notifications on public.app_notifications;
create trigger respect_staff_booking_notifications before insert on public.app_notifications
for each row execute function public.filter_staff_booking_notification();
commit;
