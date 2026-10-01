create or replace function public.get_pos_portable_reference_data(
  p_key_id uuid,
  p_session_signature text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  services_json jsonb;
  staff_json jsonb;
  target_salon_id uuid;
  target_salon_name text;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null
    or not (
      public.pos_portable_access_has_capability(p_key_id, p_session_signature, 'portable.book.view')
      or public.pos_portable_access_has_capability(p_key_id, p_session_signature, 'portable.today.view')
    )
  then
    return null;
  end if;

  select locations.name
  into target_salon_name
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
      ) order by services.name
    ),
    '[]'::jsonb
  )
  into services_json
  from public.services
  where services.salon_id = target_salon_id
    and services.is_active = true;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', staff.id,
        'display_name', staff.display_name,
        'job_title', staff.job_title,
        'is_active', staff.is_active,
        'today_status', 'not_checked_in',
        'turns', jsonb_build_object(
          'largeTurns', 0,
          'smallTurns', 0,
          'totalTurns', 0,
          'queueTurns', 0,
          'receiptLargeTurns', 0
        )
      ) order by staff.display_name
    ),
    '[]'::jsonb
  )
  into staff_json
  from public.staff
  where staff.salon_id = target_salon_id
    and staff.is_active = true
    and staff.pos_enabled = true;

  return jsonb_build_object(
    'salonName', target_salon_name,
    'services', services_json,
    'staff', staff_json
  );
end;
$$;

revoke all on function public.get_pos_portable_reference_data(uuid, text) from public;
grant execute on function public.get_pos_portable_reference_data(uuid, text) to anon, authenticated;
