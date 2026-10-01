create or replace function public.current_user_has_booking_assignment(
  target_booking_id uuid,
  target_salon_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with actor as (
    select public.current_user_staff_id_for_salon(target_salon_id) as staff_id
  )
  select exists (
    select 1
    from public.booking_lines assigned_lines
    cross join actor
    where assigned_lines.booking_id = target_booking_id
      and assigned_lines.salon_id = target_salon_id
      and actor.staff_id is not null
      and assigned_lines.assigned_staff_id = actor.staff_id
      and assigned_lines.line_status not in ('cancelled', 'skipped')
  )
$$;

create or replace function public.current_user_can_read_booking(
  target_booking_id uuid,
  target_salon_id uuid,
  target_customer_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_can_manage_salon(target_salon_id)
    or (
      target_customer_user_id is not null
      and target_customer_user_id = public.current_public_user_id()
    )
    or public.current_user_has_booking_assignment(
      target_booking_id,
      target_salon_id
    )
$$;

create or replace function public.current_user_can_read_booking_line(
  target_booking_id uuid,
  target_salon_id uuid,
  target_assigned_staff_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_can_manage_salon(target_salon_id)
    or (
      target_assigned_staff_id is not null
      and target_assigned_staff_id = public.current_user_staff_id_for_salon(target_salon_id)
    )
    or exists (
      select 1
      from public.bookings booking_rows
      where booking_rows.id = target_booking_id
        and booking_rows.salon_id = target_salon_id
        and booking_rows.customer_user_id is not null
        and booking_rows.customer_user_id = public.current_public_user_id()
    )
$$;

revoke all on function public.current_user_has_booking_assignment(uuid, uuid) from public;
revoke all on function public.current_user_can_read_booking(uuid, uuid, uuid) from public;
revoke all on function public.current_user_can_read_booking_line(uuid, uuid, uuid) from public;

grant execute on function public.current_user_has_booking_assignment(uuid, uuid) to authenticated;
grant execute on function public.current_user_can_read_booking(uuid, uuid, uuid) to authenticated;
grant execute on function public.current_user_can_read_booking_line(uuid, uuid, uuid) to authenticated;

drop policy if exists "salon_member_read_bookings" on public.bookings;

create policy "salon_member_read_bookings" on public.bookings
for select to authenticated
using (
  public.current_user_can_read_booking(id, salon_id, customer_user_id)
);

drop policy if exists "salon_member_read_booking_lines" on public.booking_lines;
drop policy if exists "customer_read_own_booking_lines" on public.booking_lines;

create policy "booking_participant_read_booking_lines" on public.booking_lines
for select to authenticated
using (
  public.current_user_can_read_booking_line(
    booking_id,
    salon_id,
    assigned_staff_id
  )
);

drop policy if exists "salon_member_read_booking_events" on public.booking_status_events;

create policy "salon_member_read_booking_events" on public.booking_status_events
for select to authenticated
using (
  public.user_can_manage_salon(salon_id)
  or public.current_user_has_booking_assignment(booking_id, salon_id)
);
