create or replace function public.get_my_staff_greeting_context(p_salon_id uuid)
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
  select jsonb_build_object(
    'date', work_day,
    'history_available', (select s.created_at < ((work_day - 1)::timestamp at time zone zone) from public.staff s where s.id=own_staff_id),
    'yesterday_services', coalesce((select sum(e.service_total) from public.pos_ticket_staff_earnings e
      join public.pos_tickets t on t.id=e.ticket_id and t.salon_id=p_salon_id
      where e.salon_id=p_salon_id and e.staff_id=own_staff_id and e.work_date=work_day-1 and t.status='closed'),0),
    'worked_yesterday', exists(select 1 from public.staff_workdays w where w.salon_id=p_salon_id and w.staff_id=own_staff_id and w.work_date=work_day-1 and w.check_in_at is not null)
      or exists(select 1 from public.pos_ticket_staff_earnings e join public.pos_tickets t on t.id=e.ticket_id and t.salon_id=p_salon_id where e.salon_id=p_salon_id and e.staff_id=own_staff_id and e.work_date=work_day-1 and t.status in ('open','closed'))
      or exists(select 1 from public.pos_ticket_items i join public.pos_tickets t on t.id=i.pos_ticket_id and t.salon_id=p_salon_id where i.salon_id=p_salon_id and i.assigned_staff_id=own_staff_id and not i.is_removed and t.status in ('open','closed') and i.created_at >= ((work_day-1)::timestamp at time zone zone) and i.created_at < (work_day::timestamp at time zone zone))
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_my_staff_greeting_context(uuid) from public, anon;
grant execute on function public.get_my_staff_greeting_context(uuid) to authenticated;
