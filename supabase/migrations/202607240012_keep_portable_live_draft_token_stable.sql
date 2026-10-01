create or replace function public.get_pos_portable_desk_data(
  p_key_id uuid,
  p_session_signature text,
  p_work_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_salon_id uuid;
  salon_name text;
  services_json jsonb;
  staff_json jsonb;
  draft_row public.pos_live_drafts%rowtype;
  draft_snapshot jsonb;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null then
    return null;
  end if;

  select locations.name
  into salon_name
  from public.locations
  where locations.id = target_salon_id
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', services.id,
        'name', services.name,
        'category', services.category,
        'base_price', services.base_price
      )
      order by services.name
    ),
    '[]'::jsonb
  )
  into services_json
  from public.services
  where services.salon_id = target_salon_id
    and services.is_active = true;

  with turn_counts as (
    select
      turns.staff_id,
      count(*) filter (where turns.turn_type = 'large')::integer as large_turns,
      count(*) filter (where turns.turn_type = 'small')::integer as small_turns,
      count(*)::integer as total_turns
    from public.pos_ticket_item_turn_parts turns
    where turns.salon_id = target_salon_id
      and turns.work_date = p_work_date
    group by turns.staff_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', staff.id,
        'display_name', staff.display_name,
        'job_title', staff.job_title,
        'is_active', staff.is_active,
        'today_status', coalesce(staff_workdays.status, 'not_checked_in'),
        'turns', jsonb_build_object(
          'largeTurns', coalesce(turn_counts.large_turns, 0),
          'smallTurns', coalesce(turn_counts.small_turns, 0),
          'totalTurns', coalesce(turn_counts.total_turns, 0)
        )
      )
      order by
        coalesce(turn_counts.total_turns, 0),
        coalesce(turn_counts.large_turns, 0),
        staff.display_name
    ),
    '[]'::jsonb
  )
  into staff_json
  from public.staff
  left join public.staff_workdays
    on staff_workdays.staff_id = staff.id
    and staff_workdays.salon_id = staff.salon_id
    and staff_workdays.work_date = p_work_date
  left join turn_counts on turn_counts.staff_id = staff.id
  where staff.salon_id = target_salon_id
    and staff.is_active = true
    and staff.pos_enabled = true;

  select *
  into draft_row
  from public.pos_live_drafts
  where salon_id = target_salon_id
  order by updated_at desc
  limit 1;

  if draft_row.id is null then
    insert into public.pos_live_drafts (
      receipt,
      salon_id,
      staff_lines,
      subtotal,
      tip,
      token,
      total,
      total_before_tip
    )
    values (
      '{}'::jsonb,
      target_salon_id,
      '[]'::jsonb,
      0,
      0,
      replace(gen_random_uuid()::text, '-', ''),
      0,
      0
    )
    returning * into draft_row;
  end if;

  select to_jsonb(snapshot)
  into draft_snapshot
  from public.get_pos_live_draft_by_token(draft_row.token) snapshot
  limit 1;

  return jsonb_build_object(
    'salonName', salon_name,
    'settings', public.get_pos_setting_payload(target_salon_id),
    'services', services_json,
    'staff', staff_json,
    'liveDraft', draft_snapshot
  );
end;
$$;

grant execute on function public.get_pos_portable_desk_data(uuid, text, date) to anon, authenticated;
