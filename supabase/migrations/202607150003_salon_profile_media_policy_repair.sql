insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'salon-profile-media',
  'salon-profile-media',
  true,
  15728640,
  array[
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

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

  if second_part in ('profile', 'looks', 'updates') then
    target_salon_id := first_part::uuid;
  elsif second_part is not null
    and second_part ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and folder_parts[3] in ('identity', 'looks') then
    target_salon_id := second_part::uuid;
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
      permission_codes
    );
end;
$$;

drop policy if exists "Public users can view salon profile media"
on storage.objects;
create policy "Public users can view salon profile media"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'salon-profile-media');

drop policy if exists "Salon profile users can upload media"
on storage.objects;
create policy "Salon profile users can upload media"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'salon-profile-media'
  and public.user_can_manage_salon_profile_media(
    name,
    array['salon_profile.manage', 'salon_profile.content.manage']::text[]
  )
);

drop policy if exists "Salon profile users can replace media"
on storage.objects;
create policy "Salon profile users can replace media"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'salon-profile-media'
  and public.user_can_manage_salon_profile_media(
    name,
    array['salon_profile.manage', 'salon_profile.content.manage']::text[]
  )
)
with check (
  bucket_id = 'salon-profile-media'
  and public.user_can_manage_salon_profile_media(
    name,
    array['salon_profile.manage', 'salon_profile.content.manage']::text[]
  )
);

drop policy if exists "Salon profile users can delete media"
on storage.objects;
create policy "Salon profile users can delete media"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'salon-profile-media'
  and public.user_can_manage_salon_profile_media(
    name,
    array['salon_profile.manage', 'salon_profile.content.manage']::text[]
  )
);

grant execute on function public.user_can_manage_salon_profile_media(text, text[])
to authenticated;

create or replace function public.salon_profile_public_salon_exists(
  target_salon_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.locations l
    join public.salon_settings ss
      on ss.salon_id = l.id
      and ss.organization_id = l.organization_id
    where l.id = target_salon_id
      and l.status = 'active'
      and ss.public_discovery_enabled = true
      and length(btrim(coalesce(ss.business_name, l.name, ''))) > 0
      and length(btrim(coalesce(ss.public_profile_tagline, ''))) > 0
      and length(btrim(coalesce(ss.phone, l.phone, ''))) > 0
      and length(btrim(coalesce(ss.address_line1, l.address_line1, ''))) > 0
      and length(btrim(coalesce(ss.city, l.city, ''))) > 0
      and length(btrim(coalesce(ss.state, l.state, ''))) > 0
      and length(btrim(coalesce(ss.postal_code, l.postal_code, ''))) > 0
      and length(btrim(coalesce(ss.public_profile_logo_path, ''))) > 0
      and length(btrim(coalesce(ss.public_profile_cover_path, ''))) > 0
      and exists (
        select 1
        from public.services s
        where s.salon_id = l.id
          and s.organization_id = l.organization_id
          and s.is_active = true
      )
      and exists (
        select 1
        from public.salon_profile_looks looks
        where looks.salon_id = l.id
          and looks.organization_id = l.organization_id
          and looks.status = 'published'
      )
  )
$$;

grant execute on function public.salon_profile_public_salon_exists(uuid)
to anon, authenticated;
