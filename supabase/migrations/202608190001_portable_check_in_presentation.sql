create or replace function public.get_pos_portable_check_in_data(
  p_key_id uuid,
  p_session_signature text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  check_in_enabled boolean;
  salon_logo_path text;
  staff_json jsonb;
  target_salon_id uuid;
  target_today date;
  target_timezone text;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null
    or not public.pos_portable_access_has_capability(p_key_id, p_session_signature, 'portable.checkin.use')
  then
    return null;
  end if;

  target_timezone := public.get_salon_business_timezone(target_salon_id);
  target_today := public.get_salon_business_date(target_salon_id);

  select settings.public_profile_logo_path
  into salon_logo_path
  from public.salon_settings settings
  where settings.salon_id = target_salon_id
  limit 1;

  select coalesce(pos_settings.staff_check_in_enabled, false)
  into check_in_enabled
  from public.pos_settings
  where pos_settings.salon_id = target_salon_id;

  if not coalesce(check_in_enabled, false) then
    return jsonb_build_object(
      'checkInEnabled', false,
      'salonLogoPath', salon_logo_path,
      'salonName', (select name from public.locations where id = target_salon_id),
      'staff', '[]'::jsonb,
      'today', target_today,
      'timezone', target_timezone
    );
  end if;

  perform public.auto_close_stale_staff_workdays(target_salon_id, target_today);
  perform public.ensure_staff_workdays_for_queue(target_salon_id, target_today);

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
        'checkInAt', staff_workdays.check_in_at,
        'checkInSequence', staff_workdays.check_in_sequence,
        'displayName', staff.display_name,
        'id', staff.id,
        'isPasscodeDefault', staff.passcode_is_default,
        'jobTitle', staff.job_title,
        'queueTurnCount', coalesce(staff_workdays.queue_turn_count, 0),
        'staffProfilePhotoPath', staff.public_profile_photo_path,
        'status', coalesce(staff_workdays.status, 'not_checked_in')
      )
      order by
        case
          when staff_workdays.status = 'working' then 1
          when staff_workdays.status = 'break' then 2
          when staff_workdays.status = 'not_checked_in' then 3
          when staff_workdays.status = 'checked_out' then 4
          when staff_workdays.status = 'auto_checked_out' then 5
          else 6
        end,
        case when staff_workdays.status in ('working', 'break') then staff_workdays.check_in_sequence end nulls last,
        staff.display_name
    ),
    '[]'::jsonb
  )
  into staff_json
  from public.staff
  left join public.staff_workdays
    on staff_workdays.staff_id = staff.id
    and staff_workdays.salon_id = staff.salon_id
    and staff_workdays.work_date = target_today
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
    and staff.pos_enabled = true;

  return jsonb_build_object(
    'checkInEnabled', true,
    'salonLogoPath', salon_logo_path,
    'salonName', (select name from public.locations where id = target_salon_id),
    'staff', staff_json,
    'today', target_today,
    'timezone', target_timezone
  );
end;
$$;

revoke all on function public.get_pos_portable_check_in_data(uuid, text) from public;
grant execute on function public.get_pos_portable_check_in_data(uuid, text) to anon, authenticated;
