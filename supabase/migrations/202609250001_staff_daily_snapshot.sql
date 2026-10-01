-- Staff portal: expose only the caller's assigned services and earnings.
-- Do not grant staff general SELECT access to tickets or coworkers' items.
create or replace function public.get_my_staff_daily_snapshot(p_salon_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  own_staff_id uuid;
  matches integer;
  work_day date;
  zone text;
  result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select count(*), min(s.id::text)::uuid into matches, own_staff_id
  from public.staff s where s.salon_id = p_salon_id and s.is_active
    and s.account_user_id = public.current_public_user_id();
  if matches = 0 then
    select count(*), min(s.id::text)::uuid into matches, own_staff_id
    from public.staff s where s.salon_id = p_salon_id and s.is_active
      and s.account_user_id is null and s.user_id = auth.uid();
  end if;
  if matches <> 1 then raise exception 'A unique active staff account link is required'; end if;
  zone := public.get_salon_business_timezone(p_salon_id);
  work_day := public.get_salon_business_date(p_salon_id);
  with own_earnings as (
    select e.* from public.pos_ticket_staff_earnings e
    where e.salon_id = p_salon_id and e.staff_id = own_staff_id and e.work_date = work_day
  ), ticket_scope as (
    select e.ticket_id as id from own_earnings e
    union
    select i.pos_ticket_id from public.pos_ticket_items i
    where i.salon_id = p_salon_id and i.assigned_staff_id = own_staff_id
      and not i.is_removed
      and i.created_at >= (work_day::timestamp at time zone zone)
      and i.created_at < ((work_day + 1)::timestamp at time zone zone)
  ), tickets as (
    select t.id, jsonb_build_object('id', t.id, 'ticket_number', t.ticket_number,
      'status', t.status, 'opened_at', t.opened_at, 'closed_at', t.closed_at,
      'customer', case when c.id is null then null else jsonb_build_object(
        'id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email) end) as detail
    from public.pos_tickets t join ticket_scope x on x.id = t.id
    left join public.customers c on c.id = t.customer_id and c.location_id = p_salon_id
    where t.salon_id = p_salon_id
  )
  select jsonb_build_object('date', work_day, 'staff_id', own_staff_id,
    'earnings', coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'ticket_id', e.ticket_id, 'staff_id', e.staff_id,
      'service_total', e.service_total, 'tip_amount', e.tip_amount,
      'total_earning', e.total_earning, 'big_turn_count', e.big_turn_count,
      'small_turn_count', e.small_turn_count, 'ticket', t.detail))
      from own_earnings e join tickets t on t.id = e.ticket_id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'pos_ticket_id', i.pos_ticket_id, 'assigned_staff_id', i.assigned_staff_id,
      'unit_price', i.unit_price, 'line_total', i.line_total, 'quantity', i.quantity,
      'created_at', i.created_at, 'service', jsonb_build_object('id', s.id,
        'name', coalesce(nullif(i.service_name_snapshot, ''), s.name)),
      'ticket', t.detail))
      from public.pos_ticket_items i join tickets t on t.id = i.pos_ticket_id
      left join public.services s on s.id = i.service_id
      where i.salon_id = p_salon_id and i.assigned_staff_id = own_staff_id
        and not i.is_removed), '[]'::jsonb)) into result;
  return result;
end;
$$;
revoke all on function public.get_my_staff_daily_snapshot(uuid) from public, anon;
grant execute on function public.get_my_staff_daily_snapshot(uuid) to authenticated;
