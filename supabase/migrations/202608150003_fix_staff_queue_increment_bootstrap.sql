create or replace function public.increment_staff_queue_turns(
  p_salon_id uuid,
  p_staff_id uuid,
  p_work_date date,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  historical_large_turn_count integer;
  next_turn_count integer;
begin
  if coalesce(p_delta, 0) <= 0 then
    perform public.ensure_staff_workday_for_queue(p_salon_id, p_staff_id, p_work_date);
    select queue_turn_count
    into next_turn_count
    from public.staff_workdays
    where salon_id = p_salon_id
      and staff_id = p_staff_id
      and work_date = p_work_date;
    return coalesce(next_turn_count, 0);
  end if;

  perform pg_advisory_xact_lock(hashtext(p_salon_id::text || ':' || p_work_date::text || ':' || p_staff_id::text));

  select greatest(count(*)::integer - coalesce(p_delta, 0), 0)
  into historical_large_turn_count
  from public.pos_ticket_item_turn_parts turns
  where turns.salon_id = p_salon_id
    and turns.staff_id = p_staff_id
    and turns.work_date = p_work_date
    and turns.turn_type = 'large';

  insert into public.staff_workdays (
    queue_turn_count,
    salon_id,
    staff_id,
    status,
    work_date
  )
  values (
    coalesce(historical_large_turn_count, 0),
    p_salon_id,
    p_staff_id,
    'not_checked_in',
    p_work_date
  )
  on conflict (salon_id, staff_id, work_date) do nothing;

  update public.staff_workdays
  set queue_turn_count = queue_turn_count + p_delta
  where salon_id = p_salon_id
    and staff_id = p_staff_id
    and work_date = p_work_date
  returning queue_turn_count into next_turn_count;

  return coalesce(next_turn_count, 0);
end;
$$;

grant execute on function public.increment_staff_queue_turns(uuid, uuid, date, integer) to anon, authenticated;
