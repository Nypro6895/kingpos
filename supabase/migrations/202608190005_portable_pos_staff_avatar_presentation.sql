-- Add unified staff avatar presentation fields to the Portable POS desk payload.
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
  check_in_enabled boolean;
  draft_row public.pos_live_drafts%rowtype;
  draft_snapshot jsonb;
  salon_name text;
  services_json jsonb;
  staff_json jsonb;
  target_salon_id uuid;
  waiting_visits_json jsonb;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null
    or not public.pos_portable_access_has_capability(p_key_id, p_session_signature, 'portable.pos.use')
  then
    return null;
  end if;

  select locations.name
  into salon_name
  from public.locations
  where locations.id = target_salon_id
  limit 1;

  select coalesce(pos_settings.staff_check_in_enabled, false)
  into check_in_enabled
  from public.pos_settings
  where pos_settings.salon_id = target_salon_id;

  perform public.auto_close_stale_staff_workdays(target_salon_id, p_work_date);
  perform public.ensure_staff_workdays_for_queue(target_salon_id, p_work_date);

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

  with receipt_turn_counts as (
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
        'accountAvatarUrl', coalesce(account_users.avatar_url, legacy_users.avatar_url),
        'beautyAvatarUrl',
          case
            when account_beauty_profiles.user_id is not null then account_users.avatar_url
            when legacy_beauty_profiles.user_id is not null then legacy_users.avatar_url
            else null
          end,
        'id', staff.id,
        'display_name', staff.display_name,
        'job_title', staff.job_title,
        'is_active', staff.is_active,
        'staffProfilePhotoPath', staff.public_profile_photo_path,
        'today_status', coalesce(staff_workdays.status, 'not_checked_in'),
        'check_in_sequence', staff_workdays.check_in_sequence,
        'check_in_at', staff_workdays.check_in_at,
        'turns', jsonb_build_object(
          'largeTurns', coalesce(staff_workdays.queue_turn_count, receipt_turn_counts.large_turns, 0),
          'smallTurns', coalesce(receipt_turn_counts.small_turns, 0),
          'totalTurns', coalesce(staff_workdays.queue_turn_count, receipt_turn_counts.large_turns, 0),
          'queueTurns', coalesce(staff_workdays.queue_turn_count, receipt_turn_counts.large_turns, 0),
          'receiptLargeTurns', coalesce(receipt_turn_counts.large_turns, 0)
        )
      )
      order by
        coalesce(staff_workdays.queue_turn_count, receipt_turn_counts.large_turns, 0),
        case when check_in_enabled then staff_workdays.check_in_sequence end nulls last,
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
  left join receipt_turn_counts on receipt_turn_counts.staff_id = staff.id
  left join public.users account_users
    on account_users.id = staff.account_user_id
  left join public.users legacy_users
    on legacy_users.auth_user_id = staff.user_id
  left join public.beauty_profiles account_beauty_profiles
    on account_beauty_profiles.user_id = account_users.id
    and account_beauty_profiles.visibility = 'public'
  left join public.beauty_profiles legacy_beauty_profiles
    on legacy_beauty_profiles.user_id = legacy_users.id
    and legacy_beauty_profiles.visibility = 'public'
  where staff.salon_id = target_salon_id
    and staff.is_active = true
    and staff.pos_enabled = true
    and (
      not coalesce(check_in_enabled, false)
      or staff_workdays.status = 'working'
    );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'appointmentId', queue.appointment_id,
        'appointmentStartAt', queue.appointment_start_at,
        'assignedStaffId', queue.assigned_staff_id,
        'assignedStaffName', queue.assigned_staff_name,
        'checkedInAt', queue.checked_in_at,
        'customerId', queue.customer_id,
        'customerName', queue.customer_name,
        'customerPhone', queue.customer_phone,
        'id', queue.id,
        'requestedServices', queue.requested_services,
        'salonId', queue.salon_id,
        'serviceLabel', queue.service_label,
        'source', queue.source,
        'status', queue.status,
        'ticketId', queue.ticket_id
      )
      order by queue.checked_in_at, queue.id
    ),
    '[]'::jsonb
  )
  into waiting_visits_json
  from public.customer_visit_queue_rows(target_salon_id, 25) queue;

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
    'waitingVisits', waiting_visits_json,
    'liveDraft', draft_snapshot
  );
end;
$$;

revoke all on function public.get_pos_portable_desk_data(uuid, text, date) from public;
grant execute on function public.get_pos_portable_desk_data(uuid, text, date) to anon, authenticated;

notify pgrst, 'reload schema';
