begin;

-- Match the application permission for staff posting without granting profile management.
create or replace function public.current_user_can_post_salon_content(target_salon_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.staff
    where id = public.current_user_staff_id_for_salon(target_salon_id)
      and salon_id = target_salon_id
      and is_active = true
      and salon_profile_content_posting_enabled = true
  )
$$;
revoke all on function public.current_user_can_post_salon_content(uuid) from public;
grant execute on function public.current_user_can_post_salon_content(uuid) to authenticated;

drop policy if exists "staff_post_content_media" on public.salon_profile_media_assets;
drop policy if exists "staff_post_content_media" on public.salon_profile_media_assets;
create policy "staff_post_content_media" on public.salon_profile_media_assets
for all to authenticated
using (
  uploaded_by_user_id = public.current_public_user_id()
  and upload_intent = 'content' and purpose in ('look', 'update')
  and public.current_user_can_post_salon_content(salon_id)
)
with check (
  uploaded_by_user_id = public.current_public_user_id()
  and upload_intent = 'content' and purpose in ('look', 'update')
  and bucket = 'salon-profile-media'
  and split_part(object_path, '/', 1) = salon_id::text
  and split_part(object_path, '/', 2) = case purpose when 'look' then 'looks' else 'updates' end
  and public.current_user_can_post_salon_content(salon_id)
);

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
  target_salon_id uuid;
  target_staff_id uuid;
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

  if first_part is null
    or first_part !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    return false;
  end if;

  if second_part in ('profile', 'looks', 'updates', 'reviews') then
    target_salon_id := first_part::uuid;
  elsif second_part = 'staff'
    and folder_parts[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and folder_parts[4] = 'avatar'
  then
    target_salon_id := first_part::uuid;
    target_staff_id := folder_parts[3]::uuid;
  else
    return false;
  end if;

  if target_staff_id is not null
    and target_staff_id = public.current_user_staff_id_for_salon(target_salon_id)
  then
    return true;
  end if;

  if second_part in ('looks', 'updates')
    and public.current_user_can_post_salon_content(target_salon_id)
    and exists (
      select 1 from public.salon_profile_media_assets assets
      where assets.salon_id = target_salon_id
        and assets.object_path = object_name
        and assets.bucket = 'salon-profile-media'
        and assets.uploaded_by_user_id = public.current_public_user_id()
        and assets.upload_intent = 'content'
        and assets.purpose = case second_part when 'looks' then 'look' else 'update' end
    )
  then
    return true;
  end if;

  return public.user_has_salon_permission(target_salon_id, permission_codes);
end;
$$;

drop policy if exists "staff_post_own_content" on public.salon_profile_looks;
create policy "staff_post_own_content" on public.salon_profile_looks
for all to authenticated
using (
  author_user_id = public.current_public_user_id()
  and author_staff_id = public.current_user_staff_id_for_salon(salon_id)
  and public.current_user_can_post_salon_content(salon_id)
)
with check (
  author_user_id = public.current_public_user_id()
  and created_by_user_id = public.current_public_user_id()
  and author_staff_id = public.current_user_staff_id_for_salon(salon_id)
  and public.current_user_can_post_salon_content(salon_id)
);

drop policy if exists "staff_post_own_content" on public.salon_profile_updates;
create policy "staff_post_own_content" on public.salon_profile_updates
for all to authenticated
using (
  author_user_id = public.current_public_user_id()
  and author_staff_id = public.current_user_staff_id_for_salon(salon_id)
  and public.current_user_can_post_salon_content(salon_id)
)
with check (
  author_user_id = public.current_public_user_id()
  and created_by_user_id = public.current_public_user_id()
  and author_staff_id = public.current_user_staff_id_for_salon(salon_id)
  and public.current_user_can_post_salon_content(salon_id)
);

drop policy if exists "staff_tag_own_content" on public.salon_profile_look_hashtags;
create policy "staff_tag_own_content" on public.salon_profile_look_hashtags
for all to authenticated
using (
  public.current_user_can_post_salon_content(salon_id)
  and exists (select 1 from public.salon_profile_looks posts
    where posts.id = salon_profile_look_hashtags.look_id and posts.salon_id = salon_profile_look_hashtags.salon_id
      and posts.author_user_id = public.current_public_user_id())
)
with check (
  public.current_user_can_post_salon_content(salon_id)
  and exists (select 1 from public.salon_profile_looks posts
    where posts.id = salon_profile_look_hashtags.look_id and posts.salon_id = salon_profile_look_hashtags.salon_id
      and posts.author_user_id = public.current_public_user_id())
);

drop policy if exists "staff_tag_own_content" on public.salon_profile_update_hashtags;
create policy "staff_tag_own_content" on public.salon_profile_update_hashtags
for all to authenticated
using (
  public.current_user_can_post_salon_content(salon_id)
  and exists (select 1 from public.salon_profile_updates posts
    where posts.id = salon_profile_update_hashtags.update_id and posts.salon_id = salon_profile_update_hashtags.salon_id
      and posts.author_user_id = public.current_public_user_id())
)
with check (
  public.current_user_can_post_salon_content(salon_id)
  and exists (select 1 from public.salon_profile_updates posts
    where posts.id = salon_profile_update_hashtags.update_id and posts.salon_id = salon_profile_update_hashtags.salon_id
      and posts.author_user_id = public.current_public_user_id())
);

create or replace function public.save_salon_profile_content_booking_config(
  p_source_type text,
  p_content_id uuid,
  p_booking_cta_enabled boolean default true,
  p_primary_service_id uuid default null,
  p_credited_staff_id uuid default null,
  p_additional_service_ids uuid[] default '{}'::uuid[],
  p_booking_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  content_look_id uuid;
  content_update_id uuid;
  saved_config_id uuid;
  service_id_value uuid;
  service_order integer := 0;
  salon_id_value uuid;
begin
  if p_source_type = 'salon_profile_look' then
    select looks.salon_id, looks.id, null::uuid
    into salon_id_value, content_look_id, content_update_id
    from public.salon_profile_looks looks
    where looks.id = p_content_id;
  elsif p_source_type = 'salon_profile_update' then
    select updates.salon_id, null::uuid, updates.id
    into salon_id_value, content_look_id, content_update_id
    from public.salon_profile_updates updates
    where updates.id = p_content_id;
  else
    raise exception 'Unsupported content booking source type.';
  end if;

  if salon_id_value is null then
    raise exception 'Content was not found.';
  end if;

  if not public.user_has_salon_permission(salon_id_value, array['salon_profile.manage', 'salon_profile.content.manage']::text[])
    and not (
      public.current_user_can_post_salon_content(salon_id_value)
      and (
        exists (select 1 from public.salon_profile_looks where id = content_look_id and author_user_id = public.current_public_user_id())
        or exists (select 1 from public.salon_profile_updates where id = content_update_id and author_user_id = public.current_public_user_id())
      )
    ) then
    raise exception 'You do not have permission to manage booking setup for this content.';
  end if;

  if p_primary_service_id is not null and not exists (
    select 1
    from public.services
    where id = p_primary_service_id
      and salon_id = salon_id_value
      and is_active = true
  ) then
    raise exception 'Choose an active service from this salon.';
  end if;

  if p_credited_staff_id is not null and not exists (
    select 1
    from public.staff
    where id = p_credited_staff_id
      and salon_id = salon_id_value
      and is_active = true
  ) then
    raise exception 'Choose an active professional from this salon.';
  end if;

  select id
  into saved_config_id
  from public.salon_profile_content_booking_configs
  where (
    p_source_type = 'salon_profile_look'
    and look_id = content_look_id
  )
  or (
    p_source_type = 'salon_profile_update'
    and update_id = content_update_id
  )
  limit 1;

  if saved_config_id is null then
    insert into public.salon_profile_content_booking_configs (
      salon_id,
      source_type,
      look_id,
      update_id,
      booking_cta_enabled,
      primary_service_id,
      credited_staff_id,
      booking_note
    )
    values (
      salon_id_value,
      p_source_type,
      content_look_id,
      content_update_id,
      coalesce(p_booking_cta_enabled, false),
      p_primary_service_id,
      p_credited_staff_id,
      nullif(btrim(coalesce(p_booking_note, '')), '')
    )
    returning id into saved_config_id;
  else
    update public.salon_profile_content_booking_configs
    set booking_cta_enabled = coalesce(p_booking_cta_enabled, false),
        primary_service_id = p_primary_service_id,
        credited_staff_id = p_credited_staff_id,
        booking_note = nullif(btrim(coalesce(p_booking_note, '')), ''),
        updated_at = now()
    where id = saved_config_id;
  end if;

  delete from public.salon_profile_content_booking_services
  where config_id = saved_config_id;

  foreach service_id_value in array coalesce(p_additional_service_ids, '{}'::uuid[])
  loop
    if service_id_value is not null and service_id_value is distinct from p_primary_service_id then
      if not exists (
        select 1
        from public.services
        where id = service_id_value
          and salon_id = salon_id_value
          and is_active = true
      ) then
        raise exception 'Additional services must belong to this salon.';
      end if;

      service_order := service_order + 1;

      insert into public.salon_profile_content_booking_services (
        salon_id,
        config_id,
        service_id,
        service_role,
        display_order
      )
      values (
        salon_id_value,
        saved_config_id,
        service_id_value,
        'additional_service',
        service_order
      )
      on conflict (config_id, service_id) do nothing;
    end if;
  end loop;

  return saved_config_id;
end;
$$;

commit;
