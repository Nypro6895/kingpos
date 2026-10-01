-- Only the authenticated staff's completed work, without general ticket access.
create or replace function public.get_my_staff_analysis_snapshot(p_salon_id uuid, p_start_date date, p_end_date date)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare own_staff_id uuid; matches integer; result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date or p_end_date - p_start_date > 366 then
    raise exception 'Invalid analysis period';
  end if;
  select count(*), min(s.id::text)::uuid into matches, own_staff_id from public.staff s
  where s.salon_id = p_salon_id and s.is_active and s.account_user_id = public.current_public_user_id();
  if matches = 0 then
    select count(*), min(s.id::text)::uuid into matches, own_staff_id from public.staff s
    where s.salon_id = p_salon_id and s.is_active and s.account_user_id is null and s.user_id = auth.uid();
  end if;
  if matches <> 1 then raise exception 'A unique active staff account link is required'; end if;
  with earnings as (
    select e.* from public.pos_ticket_staff_earnings e
    join public.pos_tickets t on t.id = e.ticket_id and t.salon_id = e.salon_id
    where e.salon_id = p_salon_id and e.staff_id = own_staff_id
      and e.work_date between p_start_date and p_end_date and t.status = 'closed'
  ), days as (
    select work_date, sum(service_total) service_total, sum(tip_amount) tip_amount,
      sum(big_turn_count + small_turn_count) turns, count(distinct ticket_id) tickets
    from earnings group by work_date
  ), services as (
    select i.service_id, coalesce(nullif(i.service_name_snapshot, ''), s.name, 'Service') service_name,
      sum(i.quantity) count, sum(i.line_total) revenue, count(distinct i.pos_ticket_id) tickets
    from public.pos_ticket_items i
    left join public.services s on s.id = i.service_id
    where i.salon_id = p_salon_id and i.assigned_staff_id = own_staff_id and not i.is_removed
      and exists (select 1 from earnings e where e.ticket_id = i.pos_ticket_id)
    group by i.service_id, coalesce(nullif(i.service_name_snapshot, ''), s.name, 'Service')
    order by revenue desc limit 5
  )
  select jsonb_build_object('staffId', own_staff_id,
    'serviceTotal', coalesce(sum(service_total),0), 'tipAmount',coalesce(sum(tip_amount),0),
    'bigTurns',coalesce(sum(big_turn_count),0),'smallTurns',coalesce(sum(small_turn_count),0),
    'totalTurns',coalesce(sum(big_turn_count + small_turn_count),0),'ticketCount',count(distinct ticket_id),
    'averageTicket',case when count(distinct ticket_id)=0 then 0 else round(sum(service_total)/count(distinct ticket_id),2) end,
    'dailyActivity',coalesce((select jsonb_agg(jsonb_build_object('businessDate',work_date,'serviceTotal',service_total,
      'tipAmount',tip_amount,'turns',turns,'tickets',tickets) order by work_date) from days),'[]'::jsonb),
    'topServices',coalesce((select jsonb_agg(jsonb_build_object('serviceId',service_id,'serviceName',service_name,
      'count',count,'revenue',revenue,'ticketCount',tickets) order by revenue desc) from services),'[]'::jsonb))
  into result from earnings;
  return result;
end;
$$;
revoke all on function public.get_my_staff_analysis_snapshot(uuid,date,date) from public, anon;
grant execute on function public.get_my_staff_analysis_snapshot(uuid,date,date) to authenticated;
notify pgrst, 'reload schema';
