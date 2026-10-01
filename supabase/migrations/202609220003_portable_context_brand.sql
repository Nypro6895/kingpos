create or replace function public.get_pos_portable_access_context(
  p_key_id uuid,
  p_session_signature text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_salon_id uuid;
  context_row record;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null then
    return null;
  end if;

  select
    access_keys.access_id,
    access_keys.capabilities,
    access_keys.id as key_id,
    locations.id as salon_id,
    locations.name as salon_name,
    settings.public_profile_logo_path as salon_logo_path
  into context_row
  from public.pos_portable_access_keys access_keys
  join public.locations on locations.id = access_keys.salon_id
  left join public.salon_settings settings on settings.salon_id = locations.id
  where access_keys.id = p_key_id
    and access_keys.salon_id = target_salon_id
  limit 1;

  return jsonb_build_object(
    'key_id', context_row.key_id,
    'access_id', context_row.access_id,
    'capabilities', to_jsonb(context_row.capabilities),
    'salon_id', context_row.salon_id,
    'salon_logo_path', context_row.salon_logo_path,
    'salon_name', context_row.salon_name
  );
end;
$$;

revoke all on function public.get_pos_portable_access_context(uuid, text) from public;
grant execute on function public.get_pos_portable_access_context(uuid, text) to anon, authenticated;
