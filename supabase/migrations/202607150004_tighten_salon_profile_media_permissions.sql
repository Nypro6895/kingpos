create or replace function public.user_can_manage_salon_profile_media(
  object_name text,
  permission_codes text[]
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  folder_parts text[];
  first_part text;
  required_permissions text[];
  second_part text;
  target_organization_id uuid;
  target_salon_id uuid;
begin
  if object_name is null or object_name = '' then
    return false;
  end if;

  if object_name like '/%' or object_name like '%..%' or object_name like '%\%' then
    return false;
  end if;

  folder_parts := storage.foldername(object_name);
  first_part := folder_parts[1];
  second_part := folder_parts[2];

  if first_part is null or first_part !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  if second_part = 'profile' then
    target_salon_id := first_part::uuid;
    required_permissions := array['salon_profile.manage']::text[];
  elsif second_part in ('looks', 'updates') then
    target_salon_id := first_part::uuid;
    required_permissions := array['salon_profile.manage', 'salon_profile.content.manage']::text[];
  elsif second_part is not null
    and second_part ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and folder_parts[3] = 'identity' then
    target_salon_id := second_part::uuid;
    required_permissions := array['salon_profile.manage']::text[];
  elsif second_part is not null
    and second_part ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and folder_parts[3] = 'looks' then
    target_salon_id := second_part::uuid;
    required_permissions := array['salon_profile.manage', 'salon_profile.content.manage']::text[];
  else
    return false;
  end if;

  select locations.organization_id
  into target_organization_id
  from public.locations
  where locations.id = target_salon_id;

  return target_organization_id is not null
    and public.user_has_organization_permission(
      target_organization_id,
      coalesce(required_permissions, permission_codes)
    );
end;
$$;

grant execute on function public.user_can_manage_salon_profile_media(text, text[])
to authenticated;
